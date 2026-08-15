"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { AiExperience, Artifact, ReviewerCandidate } from "@wanaflow/db";
import {
  CopilotChatView,
  CopilotKit,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useCopilotKit,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import {
  ArrowUpRight,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Scale,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { z } from "zod";

import {
  loadAiExperience,
  loadAiStatus,
  loadReviewerCandidates,
  recordAiChoice,
  requestArtifactReview,
  saveArtifact,
  saveAiExperienceTranscript,
  shapeAiExperienceArtifact,
} from "@/lib/api-client";
import { BpmnCanvas } from "@/components/bpmn-canvas";
import { DmnCanvas } from "@/components/dmn-canvas";
import { TaskForm } from "@/components/task-form";

type ObservabilityMode = "quiet" | "debug";
type ArtifactTab = "MAIN" | "FORM" | "DECISION";
type AiStatus = { configured: boolean; model: string };
type ToolStatus = "inProgress" | "executing" | "complete";
type UndoSnapshot = {
  artifactId: string;
  baseRevisionId: string;
  source: string;
  label: string;
};
type ChoiceArgs = {
  question?: string;
  explanation?: string;
  selection?: "SINGLE" | "MULTIPLE";
  options?: Array<{ id: string; label: string; description?: string }>;
};
type ApprovalArgs = { summary?: string };
type InterruptedHumanTool =
  | { kind: "CHOICE"; messageId: string; toolCallId: string; args: ChoiceArgs }
  | { kind: "APPROVAL"; messageId: string; toolCallId: string; args: ApprovalArgs };

const EMPTY_FORM_DATA: Record<string, unknown> = {};
const stableArtifactKeySchema = z.string().min(2).max(63)
  .regex(/^[a-z][a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens.")
  .describe("A lowercase kebab-case key. Use hyphens and never underscores.");
const bindingKeySchema = z.string().min(2).max(120)
  .regex(/^[a-z][a-z0-9.-]+$/, "Use lowercase letters, numbers, dots, and hyphens.");
const dataKeySchema = z.string().min(1).max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/, "Start with a letter or underscore and use letters, numbers, dots, underscores, or hyphens.");
const processStepSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["HUMAN", "SERVICE", "DECISION"]),
  formKey: bindingKeySchema.optional().describe("Stable key of the form attached to this HUMAN step"),
  formInputMappings: z.array(z.object({
    formField: dataKeySchema,
    processVariable: dataKeySchema,
  }).strict()).max(30).optional().describe("Form fields to prefill from existing process variables"),
  formOutputMappings: z.array(z.object({
    processVariable: dataKeySchema,
    formField: dataKeySchema,
  }).strict()).max(30).optional().describe("Process variables populated by submitted form fields"),
  jobType: bindingKeySchema.optional().describe("Stable lowercase external job type for SERVICE steps"),
  decisionKey: bindingKeySchema.optional().describe("Stable decision artifact key for DECISION steps"),
  decisionInputMappings: z.array(z.object({
    decisionInput: dataKeySchema,
    processVariable: dataKeySchema,
  }).strict()).max(16).optional().describe("Every decision input mapped from a process variable"),
  decisionOutputMappings: z.array(z.object({
    processVariable: dataKeySchema,
    decisionOutput: dataKeySchema,
  }).strict()).max(16).optional().describe("Process variables populated by decision outputs"),
}).strict();

const choiceOptionSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/),
  label: z.string().min(1).max(160),
  description: z.string().max(300).optional(),
}).strict();
const choicePromptSchema = z.object({
  question: z.string().min(1).max(1_000),
  explanation: z.string().max(500).optional(),
  selection: z.enum(["SINGLE", "MULTIPLE"]),
  options: z.array(choiceOptionSchema).min(2).max(6),
}).strict();
const approvalPromptSchema = z.object({
  summary: z.string().max(2_000).describe("A concise business summary for the reviewers"),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findInterruptedHumanTool(transcript: unknown[]): InterruptedHumanTool | null {
  const completedToolCalls = new Set<string>();
  for (const message of transcript) {
    if (!isRecord(message) || message.role !== "tool" || typeof message.toolCallId !== "string") continue;
    completedToolCalls.add(message.toolCallId);
  }

  for (let messageIndex = transcript.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = transcript[messageIndex];
    if (!isRecord(message) || message.role !== "assistant" || typeof message.id !== "string" || !Array.isArray(message.toolCalls)) continue;
    for (let callIndex = message.toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      const toolCall = message.toolCalls[callIndex];
      if (!isRecord(toolCall) || typeof toolCall.id !== "string" || completedToolCalls.has(toolCall.id) || !isRecord(toolCall.function)) continue;
      const name = toolCall.function.name;
      const parameters = parseToolArguments(toolCall.function.arguments);
      if (!parameters) continue;
      if (name === "ask_choices") {
        const parsed = choicePromptSchema.safeParse(parameters);
        if (parsed.success) return { kind: "CHOICE", messageId: message.id, toolCallId: toolCall.id, args: parsed.data };
      }
      if (name === "request_approval") {
        const parsed = approvalPromptSchema.safeParse(parameters);
        if (parsed.success) return { kind: "APPROVAL", messageId: message.id, toolCallId: toolCall.id, args: parsed.data };
      }
    }
  }
  return null;
}

function withoutInterruptedToolCall(transcript: unknown[], interrupted: InterruptedHumanTool) {
  return transcript.map((message) => {
    if (!isRecord(message) || message.id !== interrupted.messageId || !Array.isArray(message.toolCalls)) return message;
    const remaining = message.toolCalls.filter((toolCall) => !isRecord(toolCall) || toolCall.id !== interrupted.toolCallId);
    const next = { ...message };
    if (remaining.length) next.toolCalls = remaining;
    else delete next.toolCalls;
    return next;
  });
}

function normalizeStableKey(value: string) {
  let key = value.trim().toLowerCase()
    .replace(/[_.\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!/^[a-z]/.test(key)) key = `artifact-${key}`;
  key = key.slice(0, 63).replace(/-$/g, "");
  return key.length >= 2 ? key : "artifact";
}

function normalizeBindingKey(value: string) {
  let key = value.trim().toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!/^[a-z]/.test(key)) key = `binding-${key}`;
  key = key.slice(0, 120).replace(/[.-]+$/g, "");
  return key.length >= 2 ? key : "binding";
}

function toolFailure(error: unknown, startedAt: number) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "The draft could not be validated.",
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

function artifactHref(artifact: Artifact) {
  return artifact.type === "BPMN_PROCESS"
    ? `/studio/${artifact.id}`
    : artifact.type === "FORM"
      ? `/forms/${artifact.id}`
      : `/decisions/${artifact.id}`;
}

function artifactNoun(role: ArtifactTab) {
  return role === "MAIN" ? "process" : role === "FORM" ? "form" : "decision";
}

function parseForm(artifact?: Artifact) {
  if (!artifact) return null;
  try {
    return JSON.parse(artifact.revision.source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function ToolActivity({
  status,
  title,
  detail,
  mode,
  parameters,
  result,
  onUndo,
  undoing = false,
  undone = false,
}: {
  status: ToolStatus;
  title: string;
  detail: string;
  mode: ObservabilityMode;
  parameters: unknown;
  result?: string;
  onUndo?: () => void;
  undoing?: boolean;
  undone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  let parsedResult: Record<string, unknown> | undefined;
  try {
    parsedResult = result ? JSON.parse(result) as Record<string, unknown> : undefined;
  } catch {
    parsedResult = result ? { value: result } : undefined;
  }
  const failed = parsedResult?.ok === false;
  const elapsed = typeof parsedResult?.elapsedMs === "number" ? `${(parsedResult.elapsedMs / 1_000).toFixed(1)}s` : null;
  const quietDetail = status !== "complete"
    ? "Making a careful draft change"
    : failed
      ? "I adjusted the draft and kept working"
      : undone
        ? "Change restored to the previous draft"
        : detail;
  return (
    <section className="my-3 border-y border-[var(--line)] px-1 py-3" aria-live="polite">
      <div className="flex items-center gap-2.5">
        {status === "complete" ? <span className={`flex size-5 items-center justify-center rounded-full ${failed && mode === "debug" ? "bg-[var(--danger-wash)] text-[var(--danger)]" : "bg-[var(--moss-wash)] text-[var(--moss)]"}`}>{undone ? <RotateCcw className="size-3" /> : <Check className="size-3" />}</span> : <LoaderCircle className="size-4 animate-spin text-[var(--signal)]" />}
        <div className="min-w-0 flex-1"><p className="truncate text-[0.6875rem] font-bold">{title}</p><p className="mt-0.5 truncate text-[0.6rem] text-[var(--muted-ink)]">{mode === "debug" && failed ? String(parsedResult?.error ?? "Draft validation failed") : quietDetail}</p></div>
        {status === "complete" && onUndo && !failed && !undone ? <button type="button" disabled={undoing} onClick={onUndo} className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.6rem] font-bold text-[var(--muted-ink)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40">{undoing ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Undo</button> : null}
        {mode === "debug" ? <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 font-mono text-[0.56rem] text-[var(--faint-ink)]">{elapsed ?? "live"}<ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} /></button> : null}
      </div>
      {mode === "debug" && open ? <pre className="mt-3 max-h-48 overflow-auto border-t border-[var(--line)] pt-3 font-mono text-[0.56rem] leading-5 text-[var(--muted-ink)]">{JSON.stringify({ parameters, result: parsedResult }, null, 2)}</pre> : null}
    </section>
  );
}

function ChoicePrompt({
  experienceId,
  status,
  args,
  toolCallId,
  result,
  respond,
}: {
  experienceId: string;
  status: ToolStatus;
  args: ChoiceArgs;
  toolCallId: string;
  result?: string;
  respond?: (result: unknown) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = args.options ?? [];
  const selection = args.selection ?? "SINGLE";

  if (status === "inProgress" || options.length < 2) {
    return <div className="my-3 flex items-center gap-2 border-y border-[var(--line)] py-4 text-xs text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Preparing a few clear directions</div>;
  }
  if (status === "complete") {
    let selectedLabels: string[] = [];
    try {
      const parsed = result ? JSON.parse(result) as { selectedLabels?: string[] } : undefined;
      selectedLabels = parsed?.selectedLabels ?? [];
    } catch { /* A legacy transcript may contain a plain result. */ }
    return <section className="my-4 border-y border-[var(--line)] py-3"><div className="flex items-start gap-2.5"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><Check className="size-3" /></span><div className="min-w-0"><p className="text-[0.6875rem] font-semibold text-[var(--muted-ink)]">{args.question}</p><div className="mt-2 flex flex-wrap gap-1.5">{selectedLabels.length ? selectedLabels.map((label) => <span key={label} className="rounded-full bg-[var(--wash)] px-2.5 py-1 text-[0.625rem] font-bold text-[var(--ink)]">{label}</span>) : <span className="text-[0.625rem] font-bold text-[var(--moss)]">Direction shared</span>}</div></div></div></section>;
  }

  const toggle = (id: string) => {
    setSelected((current) => selection === "SINGLE"
      ? [id]
      : current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const submit = async () => {
    if (!selected.length || !respond) return;
    setPending(true);
    setError(null);
    try {
      await recordAiChoice(experienceId, {
        toolCallId,
        question: args.question ?? "Choose a direction",
        selection,
        options,
        answer: selected,
      });
      const labels = options.filter((option) => selected.includes(option.id)).map((option) => option.label);
      await respond({ selectedIds: selected, selectedLabels: labels });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That direction could not be shared.");
      setPending(false);
    }
  };

  return (
    <section className="my-4 border-y border-[var(--line-strong)] py-5">
      <p className="font-editorial text-xl font-medium leading-7 tracking-[-0.025em]">{args.question}</p>
      {args.explanation ? <p className="mt-1.5 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{args.explanation}</p> : null}
      <div className="mt-4 grid gap-2">
        {options.map((option) => {
          const active = selected.includes(option.id);
          return <button key={option.id} type="button" onClick={() => toggle(option.id)} aria-pressed={active} className={`grid grid-cols-[1.25rem_1fr] gap-2.5 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors ${active ? "border-[var(--signal)] bg-[var(--signal-wash)]" : "border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--wash)]"}`}><span className={`mt-0.5 flex size-4 items-center justify-center ${selection === "SINGLE" ? "rounded-full" : "rounded-[0.2rem]"} border ${active ? "border-[var(--signal)] bg-[var(--signal)] text-white" : "border-[var(--line-strong)]"}`}>{active ? <Check className="size-2.5" /> : null}</span><span><strong className="block text-xs">{option.label}</strong>{option.description ? <span className="mt-1 block text-[0.625rem] leading-5 text-[var(--muted-ink)]">{option.description}</span> : null}</span></button>;
        })}
      </div>
      {error ? <p role="alert" className="mt-3 text-[0.6875rem] font-semibold text-[var(--danger)]">{error}</p> : null}
      <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[0.58rem] font-semibold text-[var(--faint-ink)]">{selection === "SINGLE" ? "Choose one" : "Choose one or more"}</span><button type="button" disabled={!selected.length || pending} onClick={() => void submit()} className="flex h-9 items-center gap-2 rounded-[var(--radius)] bg-[var(--ink)] px-4 text-[0.6875rem] font-bold text-[var(--paper)] disabled:opacity-35">{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null} Continue</button></div>
    </section>
  );
}

function ApprovalPrompt({
  experienceId,
  artifact,
  status,
  args,
  toolCallId,
  result,
  respond,
}: {
  experienceId: string;
  artifact?: Artifact;
  status: ToolStatus;
  args: ApprovalArgs;
  toolCallId: string;
  result?: string;
  respond?: (result: unknown) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<ReviewerCandidate[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "executing" || !artifact || candidates) return;
    let active = true;
    void loadReviewerCandidates(artifact.id).then((value) => {
      if (active) setCandidates(value);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Reviewers could not be loaded.");
    });
    return () => { active = false; };
  }, [artifact, candidates, status]);

  if (status === "inProgress") {
    return <div className="my-3 flex items-center gap-2 border-y border-[var(--line)] py-4 text-xs text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Preparing review choices</div>;
  }

  if (status === "complete") {
    let receipt: { cancelled?: boolean; reviewId?: string; reviewerNames?: string[] } = {};
    try { receipt = result ? JSON.parse(result) as typeof receipt : {}; } catch { /* Legacy result. */ }
    if (receipt.cancelled) return <div className="my-3 flex items-center gap-2 border-y border-[var(--line)] py-3 text-[0.6875rem] font-semibold text-[var(--muted-ink)]"><Check className="size-3.5" /> Kept as a draft</div>;
    return <section className="my-4 border-y border-[var(--line)] py-4"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><CheckCircle2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold">Sent for independent review</p><p className="mt-1 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{receipt.reviewerNames?.join(", ") || "The selected reviewers"} received this exact revision.</p>{receipt.reviewId ? <Link href={`/reviews/${receipt.reviewId}`} prefetch={false} className="mt-2 inline-flex items-center gap-1.5 text-[0.6875rem] font-bold text-[var(--signal)]">Open the review <ArrowUpRight className="size-3" /></Link> : null}</div></div></section>;
  }

  const eligible = candidates?.filter((candidate) => candidate.eligible).slice(0, 5) ?? [];
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const cancel = async () => {
    if (!respond) return;
    setPending(true);
    await respond({ cancelled: true });
  };
  const submit = async () => {
    if (!artifact || !respond || !selected.length) return;
    setPending(true);
    setError(null);
    try {
      const options = [
        ...eligible.map((candidate) => ({ id: candidate.id, label: candidate.displayName, description: candidate.role === "reviewer" ? "Independent reviewer" : "Workspace approver" })),
        { id: "not-now", label: "Not now", description: "Keep this as a draft." },
      ];
      await recordAiChoice(experienceId, {
        toolCallId,
        question: "Who should review this draft?",
        selection: "MULTIPLE",
        options,
        answer: selected,
      });
      const review = await requestArtifactReview(artifact.id, {
        revisionId: artifact.revision.id,
        reviewerIds: selected,
        summary: args.summary?.trim() || `Review the ${artifact.name} experience drafted with Wana.`,
      });
      const names = eligible.filter((candidate) => selected.includes(candidate.id)).map((candidate) => candidate.displayName);
      await respond({ reviewId: review.id, status: review.status, reviewerNames: names, revisionNumber: artifact.revision.number });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review could not be requested.");
      setPending(false);
    }
  };

  return (
    <section className="my-5 border-y border-[var(--line-strong)] py-5">
      <div className="flex items-center gap-2 text-[var(--signal)]"><UsersRound className="size-4" /><span className="text-[0.625rem] font-bold uppercase tracking-[0.13em]">Approval</span></div>
      <h3 className="font-editorial mt-3 text-xl font-medium tracking-[-0.025em]">Who should review this draft?</h3>
      <p className="mt-1.5 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">The review will pin revision {artifact?.revision.number ?? "—"}. Later changes stay separate.</p>
      {!artifact ? <p role="alert" className="mt-4 text-[0.6875rem] font-semibold text-[var(--danger)]">A main process is needed before review.</p> : null}
      {artifact && !candidates && !error ? <div className="mt-4 flex items-center gap-2 text-[0.6875rem] text-[var(--muted-ink)]"><LoaderCircle className="size-3.5 animate-spin text-[var(--signal)]" /> Finding independent reviewers</div> : null}
      {eligible.length ? <div className="mt-4 grid gap-2">{eligible.map((candidate) => { const active = selected.includes(candidate.id); return <button key={candidate.id} type="button" aria-pressed={active} onClick={() => toggle(candidate.id)} className={`grid grid-cols-[1.25rem_1fr] gap-2.5 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors ${active ? "border-[var(--signal)] bg-[var(--signal-wash)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"}`}><span className={`mt-0.5 flex size-4 items-center justify-center rounded-[0.2rem] border ${active ? "border-[var(--signal)] bg-[var(--signal)] text-white" : "border-[var(--line-strong)]"}`}>{active ? <Check className="size-2.5" /> : null}</span><span><strong className="block text-xs">{candidate.displayName}</strong><span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">{candidate.email} · {candidate.role === "reviewer" ? "Independent reviewer" : "Workspace approver"}</span></span></button>; })}</div> : null}
      {candidates && !eligible.length ? <p className="mt-4 rounded-[var(--radius)] bg-[var(--gold-wash)] px-3 py-3 text-[0.6875rem] leading-5 text-[var(--ink)]">No independent reviewer is available yet. Keep the draft here, then invite a reviewer from People.</p> : null}
      {error ? <p role="alert" className="mt-3 text-[0.6875rem] font-semibold text-[var(--danger)]">{error}</p> : null}
      <div className="mt-4 flex items-center justify-end gap-2"><button type="button" disabled={pending} onClick={() => void cancel()} className="h-9 rounded-[var(--radius)] px-3 text-[0.6875rem] font-bold text-[var(--muted-ink)] hover:bg-[var(--wash)]">Not now</button>{eligible.length ? <button type="button" disabled={!selected.length || pending} onClick={() => void submit()} className="flex h-9 items-center gap-2 rounded-[var(--radius)] bg-[var(--ink)] px-4 text-[0.6875rem] font-bold text-[var(--paper)] disabled:opacity-35">{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send for review</button> : null}</div>
    </section>
  );
}

function ExperienceAgent({
  experience,
  aiStatus,
  mode,
  onModeChange,
  onExperienceChange,
  onArtifactChange,
}: {
  experience: AiExperience;
  aiStatus: AiStatus;
  mode: ObservabilityMode;
  onModeChange: (mode: ObservabilityMode) => void;
  onExperienceChange: (experience: AiExperience) => void;
  onArtifactChange: (artifactId: string, role: ArtifactTab) => void;
}) {
  const { copilotkit } = useCopilotKit();
  const localAgentId = `experience-${experience.id}`;
  const { agent, isReady } = useAgent({
    agentId: localAgentId,
    runtimeAgentId: "wanaflow-experience",
    threadId: experience.id,
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
    throttleMs: 50,
  });
  const initialized = useRef(false);
  const runningRef = useRef(false);
  const experienceRef = useRef(experience);
  const agentRef = useRef(agent);
  const recoveryReceiptRef = useRef<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [interruptedHumanTool, setInterruptedHumanTool] = useState<InterruptedHumanTool | null>(
    () => findInterruptedHumanTool(experience.transcript),
  );
  const [recoveryReceipt, setRecoveryReceipt] = useState<string | null>(null);
  const [undoSnapshots, setUndoSnapshots] = useState<Record<string, UndoSnapshot>>({});
  const [undoingToolCallId, setUndoingToolCallId] = useState<string | null>(null);
  const [undoneToolCallIds, setUndoneToolCallIds] = useState<string[]>([]);
  const mainArtifact = experience.artifacts.find((entry) => entry.role === "MAIN")?.artifact;

  useEffect(() => {
    experienceRef.current = experience;
  }, [experience]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  const refresh = useCallback(async () => {
    onExperienceChange(await loadAiExperience(experience.id));
  }, [experience.id, onExperienceChange]);

  const undoArtifactChange = useCallback(async (toolCallId: string) => {
    const snapshot = undoSnapshots[toolCallId];
    if (!snapshot || undoneToolCallIds.includes(toolCallId)) return;
    setUndoingToolCallId(toolCallId);
    setRuntimeError(null);
    try {
      const restored = await saveArtifact(snapshot.artifactId, snapshot.baseRevisionId, snapshot.source);
      setUndoneToolCallIds((current) => [...current, toolCallId]);
      onArtifactChange(restored.id, restored.type === "BPMN_PROCESS" ? "MAIN" : restored.type === "FORM" ? "FORM" : "DECISION");
      await refresh();
    } catch (reason) {
      setRuntimeError(reason instanceof Error ? reason.message : "That change could not be undone.");
    } finally {
      setUndoingToolCallId(null);
    }
  }, [onArtifactChange, refresh, undoSnapshots, undoneToolCallIds]);

  useAgentContext({
    description: "The current Wanaflow experience",
    value: {
      experienceId: experience.id,
      title: experience.title,
      brief: experience.description,
      projectId: experience.projectId,
      artifacts: experience.artifacts.map(({ role, artifact }) => ({
        role,
        key: artifact.key,
        name: artifact.name,
        revision: artifact.revision.number,
        validation: artifact.revision.validation.status,
      })),
    },
  });

  useFrontendTool({
    name: "shape_main_process",
    agentId: localAgentId,
    description: "Create or revise the main executable BPMN process from a bounded sequence of semantic work steps. Bind HUMAN steps to existing forms with formKey and form field mappings. Bind DECISION steps to existing decisions with decisionKey and complete decision input/output mappings. Call this tool alone, never in parallel with another tool.",
    parameters: z.object({
      key: stableArtifactKeySchema,
      name: z.string().min(1).max(160),
      startLabel: z.string().min(1).max(120).optional(),
      endLabel: z.string().min(1).max(120).optional(),
      steps: z.array(processStepSchema).min(1).max(12),
    }).strict(),
    handler: async (parameters, { signal, toolCall }) => {
      const startedAt = performance.now();
      try {
        const previous = experienceRef.current.artifacts.find((entry) => entry.role === "MAIN")?.artifact;
        const shaped = await shapeAiExperienceArtifact(experience.id, {
          kind: "MAIN",
          ...parameters,
          key: normalizeStableKey(parameters.key),
          steps: parameters.steps.map((step) => ({
            ...step,
            formKey: step.formKey ? normalizeBindingKey(step.formKey) : undefined,
            jobType: step.jobType ? normalizeBindingKey(step.jobType) : undefined,
            decisionKey: step.decisionKey ? normalizeBindingKey(step.decisionKey) : undefined,
          })),
        }, signal);
        if (shaped.action === "updated" && previous && previous.revision.id !== shaped.artifact.revision.id) {
          setUndoSnapshots((current) => ({ ...current, [toolCall.id]: {
            artifactId: shaped.artifact.id,
            baseRevisionId: shaped.artifact.revision.id,
            source: previous.revision.source,
            label: previous.name,
          } }));
        }
        onArtifactChange(shaped.artifact.id, "MAIN");
        await refresh();
        return JSON.stringify({ ok: true, action: shaped.action, artifactId: shaped.artifact.id, artifactKey: shaped.artifact.key, artifactName: shaped.artifact.name, revisionId: shaped.artifact.revision.id, revisionNumber: shaped.artifact.revision.number, validation: shaped.artifact.revision.validation.status, elapsedMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        return toolFailure(error, startedAt);
      }
    },
    render: ({ status, args, result, toolCallId }) => <ToolActivity status={status} title="Shaping the main process" detail="Main diagram updated" mode={mode} parameters={args} result={result} onUndo={undoSnapshots[toolCallId] ? () => void undoArtifactChange(toolCallId) : undefined} undoing={undoingToolCallId === toolCallId} undone={undoneToolCallIds.includes(toolCallId)} />,
  }, [experience.id, localAgentId, mode, onArtifactChange, refresh, undoArtifactChange, undoSnapshots, undoneToolCallIds, undoingToolCallId]);

  useFrontendTool({
    name: "create_or_update_form",
    agentId: localAgentId,
    description: "Create or revise a task form when a human step needs structured information. After this completes, revise the main process in a later call and bind the matching HUMAN step with this tool result's artifactKey. Call this tool alone, never in parallel with another tool.",
    parameters: z.object({
      key: stableArtifactKeySchema,
      name: z.string().min(1).max(160),
      description: z.string().max(600).optional(),
      fields: z.array(z.object({
        key: dataKeySchema,
        label: z.string().min(1).max(160),
        type: z.enum(["textfield", "textarea", "number", "checkbox", "datetime", "select", "radio"]),
        required: z.boolean().optional(),
        options: z.array(z.object({
          label: z.string().min(1).max(120),
          value: z.string().min(1).max(120),
        }).strict()).min(2).max(20).optional(),
      }).strict()).min(1).max(30),
    }).strict(),
    handler: async (parameters, { signal, toolCall }) => {
      const startedAt = performance.now();
      try {
        const normalizedKey = normalizeStableKey(parameters.key);
        const previous = experienceRef.current.artifacts.find((entry) => entry.role === "FORM" && entry.artifact.key === normalizedKey)?.artifact;
        const shaped = await shapeAiExperienceArtifact(experience.id, {
          kind: "FORM",
          ...parameters,
          key: normalizedKey,
        }, signal);
        if (shaped.action === "updated" && previous && previous.revision.id !== shaped.artifact.revision.id) {
          setUndoSnapshots((current) => ({ ...current, [toolCall.id]: {
            artifactId: shaped.artifact.id,
            baseRevisionId: shaped.artifact.revision.id,
            source: previous.revision.source,
            label: previous.name,
          } }));
        }
        onArtifactChange(shaped.artifact.id, "FORM");
        await refresh();
        return JSON.stringify({ ok: true, action: shaped.action, artifactId: shaped.artifact.id, artifactKey: shaped.artifact.key, artifactName: shaped.artifact.name, revisionId: shaped.artifact.revision.id, revisionNumber: shaped.artifact.revision.number, validation: shaped.artifact.revision.validation.status, elapsedMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        return toolFailure(error, startedAt);
      }
    },
    render: ({ status, args, result, toolCallId }) => <ToolActivity status={status} title="Building a task form" detail="Task form updated" mode={mode} parameters={args} result={result} onUndo={undoSnapshots[toolCallId] ? () => void undoArtifactChange(toolCallId) : undefined} undoing={undoingToolCallId === toolCallId} undone={undoneToolCallIds.includes(toolCallId)} />,
  }, [experience.id, localAgentId, mode, onArtifactChange, refresh, undoArtifactChange, undoSnapshots, undoneToolCallIds, undoingToolCallId]);

  useFrontendTool({
    name: "create_or_update_decision",
    agentId: localAgentId,
    description: "Create or revise a bounded DMN decision table with deterministic inputs, outputs, and rules. After this completes, ensure the matching DECISION step uses this tool result's artifactKey. Call this tool alone, never in parallel with another tool.",
    parameters: z.object({
      key: stableArtifactKeySchema,
      name: z.string().min(1).max(160),
      hitPolicy: z.enum(["UNIQUE", "FIRST"]),
      inputs: z.array(z.object({ name: dataKeySchema, label: z.string().min(1).max(160), type: z.enum(["string", "boolean", "number"]) }).strict()).min(1).max(8),
      outputs: z.array(z.object({ name: dataKeySchema, label: z.string().min(1).max(160), type: z.enum(["string", "boolean", "number"]) }).strict()).min(1).max(8),
      rules: z.array(z.object({
        description: z.string().max(240).optional(),
        inputEntries: z.array(z.string().max(500)).min(1).max(8),
        outputEntries: z.array(z.string().max(500)).min(1).max(8),
      }).strict()).min(1).max(30),
    }).strict(),
    handler: async (parameters, { signal, toolCall }) => {
      const startedAt = performance.now();
      try {
        const normalizedKey = normalizeStableKey(parameters.key);
        const previous = experienceRef.current.artifacts.find((entry) => entry.role === "DECISION" && entry.artifact.key === normalizedKey)?.artifact;
        const shaped = await shapeAiExperienceArtifact(experience.id, {
          kind: "DECISION",
          ...parameters,
          key: normalizedKey,
        }, signal);
        if (shaped.action === "updated" && previous && previous.revision.id !== shaped.artifact.revision.id) {
          setUndoSnapshots((current) => ({ ...current, [toolCall.id]: {
            artifactId: shaped.artifact.id,
            baseRevisionId: shaped.artifact.revision.id,
            source: previous.revision.source,
            label: previous.name,
          } }));
        }
        onArtifactChange(shaped.artifact.id, "DECISION");
        await refresh();
        return JSON.stringify({ ok: true, action: shaped.action, artifactId: shaped.artifact.id, artifactKey: shaped.artifact.key, artifactName: shaped.artifact.name, revisionId: shaped.artifact.revision.id, revisionNumber: shaped.artifact.revision.number, validation: shaped.artifact.revision.validation.status, elapsedMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        return toolFailure(error, startedAt);
      }
    },
    render: ({ status, args, result, toolCallId }) => <ToolActivity status={status} title="Modeling a business decision" detail="Decision table updated" mode={mode} parameters={args} result={result} onUndo={undoSnapshots[toolCallId] ? () => void undoArtifactChange(toolCallId) : undefined} undoing={undoingToolCallId === toolCallId} undone={undoneToolCallIds.includes(toolCallId)} />,
  }, [experience.id, localAgentId, mode, onArtifactChange, refresh, undoArtifactChange, undoSnapshots, undoneToolCallIds, undoingToolCallId]);

  useHumanInTheLoop({
    name: "ask_choices",
    agentId: localAgentId,
    description: "The only permitted way to ask the user for information or direction. Always provide 2 to 6 useful choices. Call this only after prior artifact tools complete and never in parallel with another tool.",
    parameters: choicePromptSchema,
    render: ({ status, args, toolCallId, result, respond }) => <ChoicePrompt experienceId={experience.id} status={status} args={args} toolCallId={toolCallId} result={result} respond={respond} />,
  }, [experience.id, localAgentId]);

  useHumanInTheLoop({
    name: "request_approval",
    agentId: localAgentId,
    description: "Begin the explicit human approval workflow only after the user chose approval in a prior ask_choices response. This tool pins the exact main-process revision and lets the user choose independent reviewers in chat.",
    parameters: approvalPromptSchema,
    render: ({ status, args, toolCallId, result, respond }) => <ApprovalPrompt experienceId={experience.id} artifact={mainArtifact} status={status} args={args} toolCallId={toolCallId} result={result} respond={respond} />,
  }, [experience.id, localAgentId, mainArtifact?.id, mainArtifact?.revision.id]);

  useEffect(() => {
    runningRef.current = agent.isRunning;
  }, [agent.isRunning]);

  useEffect(() => () => {
    if (runningRef.current) agent.abortRun();
  }, [agent]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = agent.subscribe({
      onMessagesChanged({ messages }) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void saveAiExperienceTranscript(experience.id, messages as unknown[]).catch(() => undefined);
        }, 650);
        const receipt = recoveryReceiptRef.current;
        if (receipt) {
          const receiptIndex = messages.findIndex((message) => message.role === "user" && message.content === receipt);
          const assistantReplied = receiptIndex >= 0
            && messages.slice(receiptIndex + 1).some((message) => message.role === "assistant");
          if (assistantReplied) {
            recoveryReceiptRef.current = null;
            setRecoveryReceipt(null);
          }
        }
      },
      onRunFailed({ error }) { setRuntimeError(error.message); },
    });
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [agent, experience.id]);

  useEffect(() => {
    if (!isReady || initialized.current) return;
    initialized.current = true;
    if (experience.transcript.length) {
      const transcript = interruptedHumanTool
        ? withoutInterruptedToolCall(experience.transcript, interruptedHumanTool)
        : experience.transcript;
      agent.setMessages(transcript as never[]);
      return;
    }
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: `${experience.title}\n\n${experience.description}`,
    });
    if (aiStatus.configured) {
      void copilotkit.runAgent({ agent }).catch((error: unknown) => {
        setRuntimeError(error instanceof Error ? error.message : "The AI run stopped unexpectedly.");
      });
    }
  }, [agent, aiStatus.configured, copilotkit, experience.description, experience.title, experience.transcript, interruptedHumanTool, isReady]);

  const resumeInterruptedHumanTool = useCallback(async (result: unknown) => {
    if (!interruptedHumanTool) return;
    let content = "Continue from the current saved draft.";
    if (isRecord(result)) {
      if (interruptedHumanTool.kind === "CHOICE" && Array.isArray(result.selectedLabels)) {
        const labels = result.selectedLabels.filter((label): label is string => typeof label === "string");
        if (labels.length) content = `Direction selected: ${labels.join(", ")}. Continue from that direction.`;
      } else if (interruptedHumanTool.kind === "APPROVAL") {
        if (result.cancelled === true) content = "Keep this as a draft for now.";
        else if (Array.isArray(result.reviewerNames)) {
          const names = result.reviewerNames.filter((name): name is string => typeof name === "string");
          if (names.length) content = `The current draft was sent for review to ${names.join(", ")}.`;
        }
      }
    }
    recoveryReceiptRef.current = content;
    setRecoveryReceipt(content);
    setInterruptedHumanTool(null);
    const currentAgent = agentRef.current;
    currentAgent.addMessage({ id: crypto.randomUUID(), role: "user", content });
    if (!aiStatus.configured) return;
    setRuntimeError(null);
    void copilotkit.runAgent({ agent: currentAgent }).catch((error: unknown) => {
      setRuntimeError(error instanceof Error ? error.message : "The AI run stopped unexpectedly.");
    });
  }, [aiStatus.configured, copilotkit, interruptedHumanTool]);

  const submit = (value: string) => {
    const text = value.trim();
    if (!text || !aiStatus.configured || agent.isRunning || interruptedHumanTool) return;
    setRuntimeError(null);
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    void copilotkit.runAgent({ agent }).catch((error: unknown) => {
      setRuntimeError(error instanceof Error ? error.message : "The AI run stopped unexpectedly.");
    });
  };
  const showRecoveryReceipt = Boolean(recoveryReceipt);

  return (
    <section className="grid min-h-0 border-r border-[var(--line)] bg-[var(--paper-raised)] lg:grid-rows-[72px_minmax(0,1fr)]">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5">
        <div className="min-w-0"><div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--paper)]"><Sparkles className="size-3.5" /></span><p className="truncate text-sm font-bold">Wana</p>{agent.isRunning ? <span className="size-1.5 animate-pulse rounded-full bg-[var(--signal)]" /> : null}</div><p className="mt-1 truncate text-[0.6rem] text-[var(--muted-ink)]">Design partner · {aiStatus.model}</p></div>
        <div className="flex rounded-[var(--radius)] border border-[var(--line)] bg-[var(--wash)] p-0.5" aria-label="Observability mode">
          <button type="button" onClick={() => onModeChange("quiet")} className={`h-7 rounded-[calc(var(--radius)-0.125rem)] px-2.5 text-[0.6rem] font-bold ${mode === "quiet" ? "bg-[var(--paper-raised)] text-[var(--ink)] shadow-sm" : "text-[var(--faint-ink)]"}`}>Quiet</button>
          <button type="button" onClick={() => onModeChange("debug")} className={`flex h-7 items-center gap-1.5 rounded-[calc(var(--radius)-0.125rem)] px-2.5 text-[0.6rem] font-bold ${mode === "debug" ? "bg-[var(--paper-raised)] text-[var(--ink)] shadow-sm" : "text-[var(--faint-ink)]"}`}><Bug className="size-3" /> Debug</button>
        </div>
      </header>
      <div className="min-h-[620px] lg:min-h-0">
        {!aiStatus.configured ? <div className="mx-5 mt-5 border-y border-[var(--gold)] bg-[var(--gold-wash)] px-4 py-3 text-[0.6875rem] leading-5 text-[var(--ink)]"><strong className="block">Live AI is ready to connect</strong><span className="text-[var(--muted-ink)]">Add <code className="font-mono text-[0.62rem]">DEEPSEEK_API_KEY</code> to start DeepSeek V4 Flash. The studio and artifact pipeline remain available without a managed CopilotKit account.</span></div> : null}
        {runtimeError ? <div role="alert" className="mx-5 mt-4 border-l-2 border-[var(--danger)] pl-3 text-[0.6875rem] leading-5 text-[var(--danger)]">{runtimeError}</div> : null}
        <div className="wana-ai-chat h-full">
        <CopilotChatView
          className="size-full"
          messages={agent.messages}
          isRunning={agent.isRunning}
          welcomeScreen={false}
          autoScroll="pin-to-send"
          onSubmitMessage={submit}
          onStop={() => agent.abortRun()}
          input={{
            className: "wana-ai-composer",
            textArea: { placeholder: aiStatus.configured ? "Describe a change, constraint, or goal…" : "Connect DeepSeek to continue…", disabled: !aiStatus.configured || agent.isRunning || Boolean(interruptedHumanTool) },
            showDisclaimer: false,
          }}
        >
          {({ scrollView, input }) => <div className="flex size-full min-h-0 flex-col"><div className="min-h-0 flex-1">{scrollView}</div>{interruptedHumanTool ? <div className="border-t border-[var(--line)] px-4"><p className="pt-3 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Conversation restored</p>{interruptedHumanTool.kind === "CHOICE" ? <ChoicePrompt experienceId={experience.id} status="executing" args={interruptedHumanTool.args} toolCallId={interruptedHumanTool.toolCallId} respond={resumeInterruptedHumanTool} /> : <ApprovalPrompt experienceId={experience.id} artifact={mainArtifact} status="executing" args={interruptedHumanTool.args} toolCallId={interruptedHumanTool.toolCallId} respond={resumeInterruptedHumanTool} />}</div> : null}{showRecoveryReceipt ? <div className="border-t border-[var(--line)] px-4 py-3"><p className="ml-auto max-w-[82%] rounded-[var(--radius)] bg-[var(--wash)] px-3.5 py-2.5 text-xs leading-5 text-[var(--ink)]">{recoveryReceipt}</p></div> : null}<div className="border-t border-[var(--line)] px-4 pb-4 pt-3">{agent.isRunning ? <div className="mb-2.5 flex items-center gap-2 px-1 text-[0.625rem] font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-3 animate-spin text-[var(--signal)]" /> Wana is working through the next useful step</div> : mode === "debug" ? <div className="mb-2.5 flex items-center gap-2 px-1 font-mono text-[0.56rem] text-[var(--faint-ink)]"><Circle className="size-2 fill-[var(--moss)] text-[var(--moss)]" /> thread {experience.id.slice(0, 8)} · {agent.messages.length} messages</div> : null}{input}<p className="mt-2 text-center text-[0.55rem] text-[var(--faint-ink)]">Wana drafts. People review, approve, and deploy.</p></div></div>}
        </CopilotChatView>
        </div>
      </div>
    </section>
  );
}

function ArtifactPanel({
  experience,
  changedArtifactId,
  changedRole,
}: {
  experience: AiExperience;
  changedArtifactId: string | null;
  changedRole: ArtifactTab | null;
}) {
  const [tab, setTab] = useState<ArtifactTab>("MAIN");
  const matching = experience.artifacts.filter((entry) => entry.role === tab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = matching.find((entry) => entry.artifact.id === selectedId) ?? matching[0];
  const formSchema = selected?.role === "FORM" ? parseForm(selected.artifact) : null;
  const recentlyChanged = selected?.artifact.id === changedArtifactId;

  return (
    <section className="grid min-h-0 grid-rows-[74px_46px_minmax(0,1fr)] bg-[var(--paper)]">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-5">
        <div className="min-w-0"><p className="section-label">Live artifacts</p><h1 className="mt-1 truncate text-sm font-bold">{experience.title}</h1></div>
        {selected ? <Link href={artifactHref(selected.artifact)} prefetch={false} className="flex h-8 items-center gap-1.5 text-[0.625rem] font-bold text-[var(--muted-ink)] hover:text-[var(--signal)]">Open in Studio <ArrowUpRight className="size-3.5" /></Link> : null}
      </header>
      <nav className="flex items-end gap-5 border-b border-[var(--line)] px-5" aria-label="Experience artifacts">
        {([
          ["MAIN", "Main diagram", GitBranch],
          ["FORM", "Forms", FileText],
          ["DECISION", "Decisions", Scale],
        ] as const).map(([value, label, Icon]) => {
          const count = experience.artifacts.filter((entry) => entry.role === value).length;
          return <button key={value} type="button" onClick={() => { setTab(value); setSelectedId(null); }} className={`relative flex h-11 items-center gap-1.5 border-b-2 text-[0.6875rem] font-bold ${tab === value ? "border-[var(--signal)] text-[var(--ink)]" : "border-transparent text-[var(--faint-ink)]"}`}><Icon className="size-3.5" /> {label}{value !== "MAIN" && count ? <span className="ml-0.5 font-mono text-[0.55rem]">{count}</span> : null}{changedRole === value && tab !== value ? <span className="absolute -right-2 top-2.5 size-1.5 animate-pulse rounded-full bg-[var(--signal)]" aria-label="Updated just now" /> : null}</button>;
        })}
      </nav>
      <div className={`relative min-h-[520px] overflow-hidden lg:min-h-0 ${recentlyChanged ? "artifact-live-pulse" : ""}`}>
        {matching.length > 1 ? <div className="absolute left-4 top-4 z-20"><select value={selected?.artifact.id} onChange={(event) => setSelectedId(event.target.value)} className="h-8 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--paper-glass-94)] px-2.5 text-[0.625rem] font-bold shadow-sm backdrop-blur">{matching.map((entry) => <option key={entry.artifact.id} value={entry.artifact.id}>{entry.artifact.name}</option>)}</select></div> : null}
        {recentlyChanged ? <div className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-full border border-[var(--moss)] bg-[var(--paper-glass-94)] px-2.5 py-1 text-[0.58rem] font-bold text-[var(--moss)] shadow-sm backdrop-blur"><span className="size-1.5 rounded-full bg-[var(--moss)]" /> Updated just now</div> : null}
        {!selected ? <div className="flex size-full min-h-[520px] items-center justify-center px-8 text-center"><div className="max-w-xs"><span className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--wash)] text-[var(--faint-ink)]">{tab === "MAIN" ? <GitBranch className="size-4" /> : tab === "FORM" ? <FileText className="size-4" /> : <Scale className="size-4" />}</span><p className="font-editorial mt-4 text-2xl text-[var(--muted-ink)]">No {artifactNoun(tab)} yet.</p><p className="mt-2 text-[0.6875rem] leading-5 text-[var(--faint-ink)]">Wana will place one here when it adds real value to the experience.</p></div></div> : null}
        {selected?.role === "MAIN" ? <BpmnCanvas key={selected.artifact.revision.id} xml={selected.artifact.revision.source} mode="view" className="size-full min-h-[520px]" /> : null}
        {selected?.role === "DECISION" ? <DmnCanvas key={selected.artifact.revision.id} xml={selected.artifact.revision.source} mode="view" className="size-full min-h-[520px]" /> : null}
        {selected?.role === "FORM" && formSchema ? <div className="h-full overflow-auto px-8 pb-16 pt-14"><div className="mx-auto max-w-xl"><TaskForm key={selected.artifact.revision.id} schema={formSchema} data={EMPTY_FORM_DATA} /></div></div> : null}
        {selected ? <div className="pointer-events-none absolute bottom-3 right-4 z-20 rounded-full border border-[var(--line)] bg-[var(--paper-glass-94)] px-2.5 py-1 font-mono text-[0.55rem] text-[var(--muted-ink)] backdrop-blur">revision {selected.artifact.revision.number} · {selected.artifact.revision.validation.status.toLowerCase()}</div> : null}
      </div>
    </section>
  );
}

export function AiExperienceWorkspace({ experienceId }: { experienceId: string }) {
  const [experience, setExperience] = useState<AiExperience | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [mode, setMode] = useState<ObservabilityMode>("quiet");
  const [error, setError] = useState<string | null>(null);
  const [changedArtifactId, setChangedArtifactId] = useState<string | null>(null);
  const [changedRole, setChangedRole] = useState<ArtifactTab | null>(null);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markArtifactChanged = useCallback((artifactId: string, role: ArtifactTab) => {
    setChangedArtifactId(artifactId);
    setChangedRole(role);
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      setChangedArtifactId(null);
      setChangedRole(null);
    }, 4_500);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAiExperience(experienceId), loadAiStatus()]).then(([nextExperience, nextStatus]) => {
      if (!active) return;
      setExperience(nextExperience);
      setAiStatus(nextStatus);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The experience could not be opened.");
    });
    return () => { active = false; };
  }, [experienceId]);

  useEffect(() => () => {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
  }, []);

  const properties = useMemo(() => ({ experienceId }), [experienceId]);

  if (error) return <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-[var(--danger)]">{error}</div>;
  if (!experience || !aiStatus) return <div className="flex min-h-full items-center justify-center gap-2 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening the experience</div>;

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      credentials="include"
      agent={`experience-${experience.id}`}
      properties={properties}
      enableInspector={mode === "debug" && process.env.NODE_ENV !== "production"}
      debug={mode === "debug" ? { events: true, lifecycle: true, verbose: false } : false}
      onError={({ error: runtimeError }) => setError(runtimeError.message)}
    >
      <div className="grid min-h-full lg:h-full lg:grid-cols-[minmax(390px,0.88fr)_minmax(520px,1.35fr)] lg:overflow-hidden">
        <ExperienceAgent experience={experience} aiStatus={aiStatus} mode={mode} onModeChange={setMode} onExperienceChange={setExperience} onArtifactChange={markArtifactChanged} />
        <ArtifactPanel experience={experience} changedArtifactId={changedArtifactId} changedRole={changedRole} />
      </div>
    </CopilotKit>
  );
}
