"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact, Review, ReviewerCandidate, TaskOwnerOptions } from "@wanaflow/db";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  CloudOff,
  Clock3,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  UserRoundCheck,
  X,
  FileText,
  FlaskConical,
  Scale,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import {
  BpmnCanvas,
  type BpmnCanvasHandle,
  type SelectedElement,
} from "./bpmn-canvas";
import { CollaborationPresence } from "./collaboration-presence";
import { ProcessSimulation } from "./process-simulation";
import { StudioComments } from "./studio-comments";
import { StudioJourney } from "./studio-journey";
import { StudioTour } from "./studio-tour";
import { useArtifactPresence } from "@/lib/use-artifact-presence";
import {
  loadArtifact,
  loadLibrary,
  loadReview,
  loadReviewerCandidates,
  loadReviews,
  loadTaskOwnerOptions,
  requestArtifactReview,
  saveArtifact,
  WanaflowApiError,
} from "@/lib/api-client";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

type RecoveryDraft = {
  artifactId: string;
  baseRevisionId: string;
  source: string;
  savedAt: string;
};

function recoveryStorageKey(artifactId: string) {
  return `wanaflow:draft-recovery:${artifactId}`;
}

function readRecoveryDraft(artifactId: string): RecoveryDraft | null {
  try {
    const value = window.localStorage.getItem(recoveryStorageKey(artifactId));
    if (!value) return null;
    const parsed = JSON.parse(value) as RecoveryDraft;
    return parsed.artifactId === artifactId && parsed.source ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecoveryDraft(draft: RecoveryDraft) {
  window.localStorage.setItem(recoveryStorageKey(draft.artifactId), JSON.stringify(draft));
}

function clearRecoveryDraft(artifactId: string) {
  window.localStorage.removeItem(recoveryStorageKey(artifactId));
}

function mappingText(mapping: Record<string, string>) {
  return Object.entries(mapping).map(([left, right]) => `${left} = ${right}`).join("\n");
}

function parseMappingText(value: string) {
  const mapping: Record<string, string> = {};
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || !line.slice(separator + 1).trim()) {
      throw new Error(`Mapping line ${index + 1} must look like “left = right”.`);
    }
    mapping[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return mapping;
}

function headersText(headers: Record<string, null | boolean | number | string>) {
  return Object.entries(headers).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n");
}

function parseHeadersText(value: string) {
  const headers: Record<string, null | boolean | number | string> = {};
  for (const [index, rawLine] of value.split("\n").entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error(`Header line ${index + 1} must look like “key = value”.`);
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    let parsed: unknown;
    try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue; }
    if (parsed !== null && !["boolean", "number", "string"].includes(typeof parsed)) throw new Error(`Header ${key} must be a string, number, boolean, or null.`);
    headers[key] = parsed as null | boolean | number | string;
  }
  return headers;
}

export function StudioWorkspace({ artifactId }: { artifactId?: string }) {
  const canvasRef = useRef<BpmnCanvasHandle>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [recoveryDraft, setRecoveryDraft] = useState<RecoveryDraft | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [restoredSource, setRestoredSource] = useState<string | null>(null);
  const [canvasNonce, setCanvasNonce] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const recoveryCheckedRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [validationOpen, setValidationOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedElement | null>({
    id: "Task_CollectDetails",
    name: "Collect employee details",
    type: "UserTask",
    formBinding: null,
    assignmentBinding: { kind: "STARTER" },
  });
  const [forms, setForms] = useState<Artifact[]>([]);
  const [decisions, setDecisions] = useState<Artifact[]>([]);
  const [taskOwners, setTaskOwners] = useState<TaskOwnerOptions>({ people: [], groups: [] });
  const [taskOwner, setTaskOwner] = useState("starter");
  const [formKey, setFormKey] = useState("");
  const [inputMapping, setInputMapping] = useState("");
  const [outputMapping, setOutputMapping] = useState("");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [jobType, setJobType] = useState("");
  const [jobInputMapping, setJobInputMapping] = useState("");
  const [jobOutputMapping, setJobOutputMapping] = useState("");
  const [jobHeaders, setJobHeaders] = useState("");
  const [jobLockDuration, setJobLockDuration] = useState("PT30S");
  const [jobMaxAttempts, setJobMaxAttempts] = useState(3);
  const [jobRetryBackoff, setJobRetryBackoff] = useState("PT10S");
  const [timerType, setTimerType] = useState<"DURATION" | "DATE">("DURATION");
  const [timerExpression, setTimerExpression] = useState("PT15M");
  const [messageName, setMessageName] = useState("expense.approved");
  const [correlationKeyVariable, setCorrelationKeyVariable] = useState("expenseId");
  const [messagePayloadMapping, setMessagePayloadMapping] = useState("");
  const [decisionKey, setDecisionKey] = useState("");
  const [decisionInputMapping, setDecisionInputMapping] = useState("");
  const [decisionOutputMapping, setDecisionOutputMapping] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [reviewers, setReviewers] = useState<ReviewerCandidate[]>([]);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [reviewSummary, setReviewSummary] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationHighlight, setSimulationHighlight] = useState<string | null>(null);
  const { collaborators, connection, currentRevisionId, announceRevision } = useArtifactPresence({
    artifactId: artifact?.id ?? null,
    revisionId: artifact?.revision.id ?? null,
    selectedElement: selected ? { id: selected.id, name: selected.name, type: selected.type } : null,
    cursor,
  });
  const recoveryIsDivergent = Boolean(
    recoveryDraft && currentRevisionId && recoveryDraft.baseRevisionId !== currentRevisionId,
  );

  const bootstrap = useCallback(async () => {
    setLoadError(null);
    try {
      const draft = artifactId
        ? await loadArtifact(artifactId)
        : (await loadLibrary()).workspaces.flatMap((workspace) => workspace.projects).flatMap((project) => project.artifacts)[0];
      if (!draft) throw new Error("Create or import a BPMN process before opening Studio.");
      setArtifact(draft);
      setSaveState("saved");
      recoveryCheckedRef.current = draft.id;
      const recovered = readRecoveryDraft(draft.id);
      if (recovered && recovered.source !== draft.revision.source) {
        setRecoveryDraft(recovered);
        setRecoveryOpen(true);
        if (recovered.baseRevisionId !== draft.revision.id) {
          setSaveState("conflict");
          setSaveMessage("The shared draft moved forward while this local copy was waiting.");
        }
      } else if (recovered) {
        clearRecoveryDraft(draft.id);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Studio could not reach Wanaflow.");
    }
  }, [artifactId]);

  useEffect(() => {
    let active = true;
    const load = artifactId
      ? loadArtifact(artifactId)
      : loadLibrary().then(
          (library) => library.workspaces.flatMap((workspace) => workspace.projects).flatMap((project) => project.artifacts)[0],
        );
    load
      .then((draft) => {
        if (!active) return;
        if (!draft) throw new Error("Create or import a BPMN process before opening Studio.");
        setArtifact(draft);
        setSaveState("saved");
        recoveryCheckedRef.current = draft.id;
        const recovered = readRecoveryDraft(draft.id);
        if (recovered && recovered.source !== draft.revision.source) {
          setRecoveryDraft(recovered);
          setRecoveryOpen(true);
          if (recovered.baseRevisionId !== draft.revision.id) {
            setSaveState("conflict");
            setSaveMessage("The shared draft moved forward while this local copy was waiting.");
          }
        } else if (recovered) {
          clearRecoveryDraft(draft.id);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Studio could not reach Wanaflow.");
      });
    return () => {
      active = false;
    };
  }, [artifactId]);

  const onSelectionChange = useCallback((element: SelectedElement | null) => {
    setSelected(element);
    setFormKey(element?.formBinding?.formKey ?? "");
    setInputMapping(mappingText(element?.formBinding?.inputMapping ?? {}));
    setOutputMapping(mappingText(element?.formBinding?.outputMapping ?? {}));
    setTaskOwner(
      element?.assignmentBinding?.kind === "PERSON"
        ? `person:${element.assignmentBinding.email}`
        : element?.assignmentBinding?.kind === "GROUP"
          ? `group:${element.assignmentBinding.groupKey}`
          : "starter",
    );
    setJobType(element?.jobBinding?.jobType ?? "");
    setJobInputMapping(mappingText(element?.jobBinding?.inputMapping ?? {}));
    setJobOutputMapping(mappingText(element?.jobBinding?.outputMapping ?? {}));
    setJobHeaders(headersText(element?.jobBinding?.headers ?? {}));
    setJobLockDuration(element?.jobBinding?.lockDuration ?? "PT30S");
    setJobMaxAttempts(element?.jobBinding?.maxAttempts ?? 3);
    setJobRetryBackoff(element?.jobBinding?.retryBackoff ?? "PT10S");
    setTimerType(element?.timerBinding?.timerType ?? "DURATION");
    setTimerExpression(element?.timerBinding?.expression ?? "PT15M");
    const messageContract = element?.messageThrowBinding ?? element?.messageBinding;
    setMessageName(messageContract?.messageName ?? "expense.approved");
    setCorrelationKeyVariable(messageContract?.correlationKeyVariable ?? "expenseId");
    setMessagePayloadMapping(mappingText(element?.messageThrowBinding?.payloadMapping ?? {}));
    setDecisionKey(element?.decisionBinding?.decisionKey ?? "");
    setDecisionInputMapping(mappingText(element?.decisionBinding?.inputMapping ?? {}));
    setDecisionOutputMapping(mappingText(element?.decisionBinding?.outputMapping ?? {}));
    setMappingError(null);
    if (element) setInspectorOpen(true);
  }, []);

  useEffect(() => {
    if (!artifact) return;
    let active = true;
    loadLibrary().then((library) => {
      if (!active) return;
      const project = library.workspaces.flatMap((workspace) => workspace.projects).find((candidate) => candidate.id === artifact.projectId);
      setForms(project?.artifacts.filter((candidate) => candidate.type === "FORM") ?? []);
      setDecisions(project?.artifacts.filter((candidate) => candidate.type === "DMN_DECISION") ?? []);
      if (project) void loadTaskOwnerOptions(project.id).then(setTaskOwners).catch(() => undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [artifact]);

  const applyFormBinding = () => {
    if (!selected || selected.type !== "UserTask" || !canvasRef.current) return;
    try {
      const binding = formKey
        ? {
            formKey,
            inputMapping: parseMappingText(inputMapping),
            outputMapping: parseMappingText(outputMapping),
          }
        : null;
      canvasRef.current.setUserTaskFormBinding(selected.id, binding);
      setSelected({ ...selected, formBinding: binding });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The form binding could not be applied.");
    }
  };

  const applyTaskOwner = (value: string) => {
    if (!selected || selected.type !== "UserTask" || !canvasRef.current) return;
    const binding = value === "starter"
      ? { kind: "STARTER" as const }
      : value.startsWith("person:")
        ? { kind: "PERSON" as const, email: value.slice("person:".length) }
        : { kind: "GROUP" as const, groupKey: value.slice("group:".length) };
    canvasRef.current.setUserTaskAssignmentBinding(selected.id, binding);
    setTaskOwner(value);
    setSelected({ ...selected, assignmentBinding: binding });
  };

  const applyDecisionBinding = () => {
    if (!selected || selected.type !== "BusinessRuleTask" || !canvasRef.current) return;
    try {
      const binding = decisionKey
        ? {
            decisionKey,
            inputMapping: parseMappingText(decisionInputMapping),
            outputMapping: parseMappingText(decisionOutputMapping),
          }
        : null;
      canvasRef.current.setDecisionBinding(selected.id, binding);
      setSelected({ ...selected, decisionBinding: binding });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The decision binding could not be applied.");
    }
  };

  const applyJobBinding = () => {
    if (!selected || selected.type !== "ServiceTask" || !canvasRef.current) return;
    try {
      const binding = jobType
        ? {
            jobType: jobType.trim(),
            inputMapping: parseMappingText(jobInputMapping),
            outputMapping: parseMappingText(jobOutputMapping),
            headers: parseHeadersText(jobHeaders),
            lockDuration: jobLockDuration.trim(),
            maxAttempts: jobMaxAttempts,
            retryBackoff: jobRetryBackoff.trim(),
          }
        : null;
      canvasRef.current.setExternalJobBinding(selected.id, binding);
      setSelected({ ...selected, jobBinding: binding });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The worker job could not be applied.");
    }
  };

  const applyTimerBinding = () => {
    if (!selected || selected.type !== "IntermediateCatchEvent" || !canvasRef.current) return;
    try {
      const expression = timerExpression.trim();
      if (!expression) throw new Error("Choose when this pause should end.");
      if (timerType === "DURATION" && !/^P/.test(expression)) {
        throw new Error("A duration begins with P, for example PT15M or P1D.");
      }
      if (timerType === "DATE" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(expression)) {
        throw new Error("An exact moment needs Z or a UTC offset, for example 2030-06-02T08:30:00Z.");
      }
      const binding = { timerType, expression };
      canvasRef.current.setTimerBinding(selected.id, binding);
      setSelected({ ...selected, timerBinding: binding });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The timer could not be applied.");
    }
  };

  const applyMessageBinding = () => {
    if (!selected || selected.type !== "IntermediateCatchEvent" || !canvasRef.current) return;
    try {
      const normalizedName = messageName.trim();
      const normalizedVariable = correlationKeyVariable.trim();
      if (!/^[a-z][a-z0-9.-]{1,119}$/.test(normalizedName)) {
        throw new Error("Use a stable lowercase message name, for example expense.approved.");
      }
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(normalizedVariable)) {
        throw new Error("Choose a stable process variable, for example expenseId.");
      }
      const binding = { messageName: normalizedName, correlationKeyVariable: normalizedVariable };
      canvasRef.current.setMessageBinding(selected.id, binding);
      setSelected({ ...selected, catchKind: "MESSAGE", messageBinding: binding, timerBinding: null });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The message contract could not be applied.");
    }
  };

  const applyMessageThrowBinding = () => {
    if (!selected || selected.type !== "IntermediateThrowEvent" || !canvasRef.current) return;
    try {
      const normalizedName = messageName.trim();
      const normalizedVariable = correlationKeyVariable.trim();
      if (!/^[a-z][a-z0-9.-]{1,119}$/.test(normalizedName)) {
        throw new Error("Use a stable lowercase message name, for example expense.approved.");
      }
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(normalizedVariable)) {
        throw new Error("Choose a stable process variable, for example expenseId.");
      }
      const binding = {
        messageName: normalizedName,
        correlationKeyVariable: normalizedVariable,
        payloadMapping: parseMappingText(messagePayloadMapping),
      };
      canvasRef.current.setMessageThrowBinding(selected.id, binding);
      setSelected({ ...selected, messageThrowBinding: binding });
      setMappingError(null);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : "The outbound message could not be applied.");
    }
  };

  const onDirtyChange = useCallback(() => {
    setSaveState((state) => (state === "saving" ? state : "dirty"));
    setDraftVersion((version) => version + 1);
    setReview(null);
    setSaveMessage(null);
  }, []);

  const save = useCallback(async () => {
    if (!artifact || !canvasRef.current || saveState === "saving") return;
    setSaveState("saving");
    setSaveMessage(null);
    let source: string | null = null;
    try {
      source = await canvasRef.current.saveXml();
      const saved = await saveArtifact(artifact.id, artifact.revision.id, source);
      setArtifact(saved);
      setRestoredSource(null);
      setRecoveryDraft(null);
      setRecoveryOpen(false);
      clearRecoveryDraft(artifact.id);
      setSaveState("saved");
      setSyncMessage(`Revision ${saved.revision.number} shared with the team`);
      announceRevision();
    } catch (error) {
      if (error instanceof WanaflowApiError && error.code === "REVISION_CONFLICT") {
        if (source) {
          const recovered = {
            artifactId: artifact.id,
            baseRevisionId: artifact.revision.id,
            source,
            savedAt: new Date().toISOString(),
          };
          writeRecoveryDraft(recovered);
          setRecoveryDraft(recovered);
          setRecoveryOpen(true);
        }
        setSaveState("conflict");
        setSaveMessage("Another editor saved first. Both copies are safe.");
      } else {
        setSaveState("error");
        setSaveMessage(error instanceof Error ? error.message : "The draft could not be saved.");
      }
    }
  }, [announceRevision, artifact, saveState]);

  useEffect(() => {
    if (!artifact || saveState !== "dirty" || !canvasRef.current) return;
    const timeout = window.setTimeout(() => {
      void canvasRef.current?.saveXml().then((source) => {
        const recovered = {
          artifactId: artifact.id,
          baseRevisionId: artifact.revision.id,
          source,
          savedAt: new Date().toISOString(),
        };
        writeRecoveryDraft(recovered);
        setRecoveryDraft(recovered);
      }).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [artifact, draftVersion, saveState]);

  useEffect(() => {
    if (saveState !== "dirty" || connection === "offline" || connection === "retrying") return;
    const timeout = window.setTimeout(() => void save(), 1_400);
    return () => window.clearTimeout(timeout);
  }, [connection, draftVersion, save, saveState]);

  useEffect(() => {
    if (!syncMessage) return;
    const timeout = window.setTimeout(() => setSyncMessage(null), 3_200);
    return () => window.clearTimeout(timeout);
  }, [syncMessage]);

  useEffect(() => {
    if (!artifact || !currentRevisionId || currentRevisionId === artifact.revision.id || syncingRef.current) return;
    if (saveState === "conflict") return;
    syncingRef.current = true;
    const teammate = collaborators.find((entry) => entry.revisionId === currentRevisionId)?.principal.displayName ?? "A teammate";

    if (saveState === "saved") {
      void loadArtifact(artifact.id).then((latest) => {
        if (latest.revision.id === artifact.revision.id) return;
        setArtifact(latest);
        setRestoredSource(null);
        setCanvasNonce((value) => value + 1);
        setSelected(null);
        setSyncMessage(`${teammate} shared revision ${latest.revision.number}`);
      }).catch(() => undefined).finally(() => {
        syncingRef.current = false;
      });
      return;
    }

    void canvasRef.current?.saveXml().then((source) => {
      const recovered = {
        artifactId: artifact.id,
        baseRevisionId: artifact.revision.id,
        source,
        savedAt: new Date().toISOString(),
      };
      writeRecoveryDraft(recovered);
      setRecoveryDraft(recovered);
      setRecoveryOpen(true);
      setSaveState("conflict");
      setSaveMessage(`${teammate} saved a newer shared draft. Your local work is protected.`);
    }).catch(() => undefined).finally(() => {
      syncingRef.current = false;
    });
  }, [artifact, collaborators, currentRevisionId, saveState]);

  useEffect(() => {
    if (!artifact) return;
    let active = true;
    const refresh = async () => {
      try {
        const reviews = await loadReviews();
        const existing = reviews.find(
          (candidate) => candidate.artifact.id === artifact.id && candidate.revision.id === artifact.revision.id,
        );
        const next = existing ? await loadReview(existing.id) : null;
        if (active) setReview(next);
      } catch {
        // Review status is supportive UI; Studio remains usable if it cannot refresh.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [artifact]);

  const openReviewPanel = async () => {
    if (!artifact) return;
    setReviewPanelOpen(true);
    setReviewError(null);
    try {
      const candidates = await loadReviewerCandidates(artifact.id);
      setReviewers(candidates);
      setSelectedReviewerIds(candidates.filter((candidate) => candidate.eligible).slice(0, 1).map((candidate) => candidate.id));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "Reviewers could not be loaded.");
    }
  };

  const submitReview = async () => {
    if (!artifact || !selectedReviewerIds.length) return;
    setReviewPending(true);
    setReviewError(null);
    try {
      const created = await requestArtifactReview(artifact.id, {
        revisionId: artifact.revision.id,
        reviewerIds: selectedReviewerIds,
        summary: reviewSummary,
      });
      setReview(created);
      setReviewPanelOpen(false);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The review could not be requested.");
    } finally {
      setReviewPending(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  const acceptSharedDraft = async () => {
    if (!artifact) return;
    try {
      const latest = await loadArtifact(artifact.id);
      clearRecoveryDraft(artifact.id);
      setRecoveryDraft(null);
      setRecoveryOpen(false);
      setRestoredSource(null);
      setCanvasNonce((value) => value + 1);
      setArtifact(latest);
      setSaveState("saved");
      setSaveMessage(null);
      setSyncMessage(`Shared revision ${latest.revision.number} loaded`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "The latest revision could not be loaded.");
    }
  };

  const restoreRecoveredDraft = () => {
    if (!artifact || !recoveryDraft) return;
    setRestoredSource(recoveryDraft.source);
    setCanvasNonce((value) => value + 1);
    setRecoveryOpen(false);
    setSaveState("dirty");
    setSaveMessage(null);
    setDraftVersion((value) => value + 1);
  };

  const keepLocalCopy = async () => {
    if (!artifact || !recoveryDraft) return;
    setSaveState("saving");
    setSaveMessage(null);
    try {
      const latest = await loadArtifact(artifact.id);
      const saved = await saveArtifact(artifact.id, latest.revision.id, recoveryDraft.source);
      clearRecoveryDraft(artifact.id);
      setRecoveryDraft(null);
      setRecoveryOpen(false);
      setRestoredSource(null);
      setCanvasNonce((value) => value + 1);
      setArtifact(saved);
      setSaveState("saved");
      setSyncMessage(`Your copy is now shared as revision ${saved.revision.number}`);
      announceRevision();
    } catch (error) {
      setSaveState(error instanceof WanaflowApiError && error.code === "REVISION_CONFLICT" ? "conflict" : "error");
      setSaveMessage(error instanceof Error ? error.message : "Your protected copy could not be shared yet.");
    }
  };

  if (loadError) {
    return (
      <div className="workspace-page flex h-full min-h-[640px] items-center justify-center px-6">
        <div className="max-w-md text-center">
          <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-[var(--danger-wash)] text-[var(--danger)]">
            <CloudOff className="size-6 stroke-[1.5]" />
          </span>
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--danger)]">Studio is offline</p>
          <h1 className="font-editorial mt-3 text-4xl font-medium tracking-[-0.045em]">Studio could not open this draft.</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">{loadError}</p>
          <Link href="/library" prefetch={false} className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-[var(--signal)]"><ArrowLeft className="size-3.5" /> Return to the library</Link>
          <Button variant="outline" className="mt-6" onClick={() => void bootstrap()}><RefreshCw className="size-3.5" /> Try again</Button>
        </div>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="workspace-page flex h-full min-h-[640px] items-center justify-center">
        <span className="flex items-center gap-3 text-xs font-semibold text-[var(--muted-ink)]">
          <LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening the persisted draft
        </span>
      </div>
    );
  }

  const validation = artifact.revision.validation;
  const errorCount = validation.issues.filter((issue) => issue.severity === "ERROR").length;
  const warningCount = validation.issues.filter((issue) => issue.severity === "WARNING").length;

  return (
    <div className="workspace-page grid h-full min-h-[640px] grid-rows-[52px_minmax(0,1fr)_30px] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/library" prefetch={false} className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]" aria-label="Back to library"><ArrowLeft className="size-4" /></Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-[-0.025em]">{artifact.name}</h1>
              <StudioJourney review={review} />
              <button type="button" className="rounded-full p-1 text-[var(--faint-ink)] hover:bg-[var(--wash)]" aria-label="Open artifact menu">
                <ChevronDown className="size-3.5" />
              </button>
            </div>
            <p className="text-[0.625rem] font-semibold text-[var(--muted-ink)]">BPMN · Draft revision {artifact.revision.number}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <CollaborationPresence collaborators={collaborators} connection={connection} />
          <span className={`mr-2 hidden items-center gap-1.5 text-[0.625rem] font-semibold sm:flex ${saveState === "error" || saveState === "conflict" ? "text-[var(--danger)]" : saveState === "dirty" ? "text-[var(--gold)]" : "text-[var(--moss)]"}`}>
            {saveState === "saving" ? <LoaderCircle className="size-3 animate-spin" /> : saveState === "dirty" ? <span className="size-1.5 rounded-full bg-current" /> : saveState === "conflict" || saveState === "error" ? <AlertTriangle className="size-3" /> : <Check className="size-3" />}
            {saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : saveState === "conflict" ? "Save conflict" : saveState === "error" ? "Save failed" : "All changes saved"}
          </span>
          <Button variant="quiet" size="icon-sm" onClick={() => setValidationOpen((open) => !open)} aria-label="Open validation">
            <ListChecks className="size-4" />
          </Button>
          <Button variant="quiet" size="icon-sm" onClick={() => setCommentsOpen(true)} aria-label="Open comments" className="relative">
            <MessageCircle className="size-4" />
            {review?.comments.filter((comment) => !comment.resolvedAt).length ? <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-[var(--signal)] text-[0.5rem] font-bold text-white">{Math.min(9, review.comments.filter((comment) => !comment.resolvedAt).length)}</span> : null}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setSimulationOpen(true)} disabled={saveState !== "saved"} title={saveState === "saved" ? "Preview this saved draft" : "Wait for autosave before previewing"}>
            <FlaskConical className="size-3.5" /><span className="hidden sm:inline">Test</span>
          </Button>
          {saveState === "dirty" || saveState === "saving" || saveState === "error" ? (
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={saveState === "saving"}>
              <Save className="size-3.5" /> Save
            </Button>
          ) : review ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/reviews/${review.id}`} prefetch={false}>
                <Check className="size-3.5" /> {review.publication ? "Published" : review.status === "APPROVED" ? "Approved" : review.status === "CHANGES_REQUESTED" ? "Changes requested" : review.status === "CANCELLED" ? "Review cancelled" : "Review requested"}
              </Link>
            </Button>
          ) : (
            <Button
              variant="signal"
              size="sm"
              onClick={() => void openReviewPanel()}
              disabled={saveState === "conflict"}
            >
              Request review
            </Button>
          )}
        </div>
      </div>

      <div className="relative grid min-h-0 min-w-0 transition-[grid-template-columns] duration-300 lg:grid-cols-[minmax(0,1fr)_auto]">
        <BpmnCanvas
          key={`${artifact.revision.id}:${canvasNonce}`}
          ref={canvasRef}
          xml={restoredSource ?? artifact.revision.source}
          highlightElementId={simulationHighlight ?? undefined}
          onSelectionChange={onSelectionChange}
          onDirtyChange={onDirtyChange}
          collaborators={collaborators}
          onCursorChange={setCursor}
          className="border-r border-[var(--line)]"
        />
        <StudioTour />

        {syncMessage ? (
          <div className="absolute left-1/2 top-4 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raised-glass-97)] px-3 py-2 text-[0.6875rem] font-semibold text-[var(--moss)] shadow-sm backdrop-blur">
            <Check className="size-3.5" /><span className="truncate">{syncMessage}</span>
          </div>
        ) : null}

        {saveMessage && !recoveryOpen ? (
          <div className="absolute left-1/2 top-4 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-2.5 text-xs font-semibold shadow-[0_12px_42px_rgba(27,26,23,0.13)]">
            <AlertTriangle className="size-4 shrink-0 text-[var(--danger)]" />
            <span className="truncate">{saveMessage}</span>
          </div>
        ) : null}

        {recoveryOpen && recoveryDraft ? (
          <section className="absolute left-1/2 top-4 z-40 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--paper-raised)] p-5 shadow-xl" aria-label="Draft recovery">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--gold-wash)] text-[var(--gold)]"><RefreshCw className="size-4" /></span>
              <div className="min-w-0"><p className="text-sm font-semibold">{recoveryIsDivergent ? "Two drafts, both safe" : "Unsaved work found"}</p><p className="mt-1 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{recoveryIsDivergent ? saveMessage ?? "The team saved a shared revision while your local copy was still changing." : "Studio kept a local copy before the interruption."}</p><p className="mt-2 text-[0.6rem] text-[var(--faint-ink)]">Protected {new Date(recoveryDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="quiet" size="sm" onClick={() => void acceptSharedDraft()}>{recoveryIsDivergent ? "Use shared draft" : "Discard local copy"}</Button>
              {recoveryIsDivergent ? <Button variant="primary" size="sm" onClick={() => void keepLocalCopy()} disabled={saveState === "saving"}>Keep my copy as latest</Button> : <Button variant="primary" size="sm" onClick={restoreRecoveredDraft}>Restore my work</Button>}
            </div>
            {recoveryIsDivergent ? <p className="mt-3 border-t border-[var(--line)] pt-3 text-[0.6rem] leading-5 text-[var(--faint-ink)]">Whichever copy you choose, the other revision remains immutable in history.</p> : null}
          </section>
        ) : null}

        {validationOpen ? (
          <section className="absolute right-4 top-4 z-30 w-[min(340px,calc(100%-2rem))] rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--raised-glass-97)] p-4 shadow-lg backdrop-blur-xl" aria-label="Validation summary">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Server validation</p>
                <h2 className="mt-1 text-sm font-semibold">{validation.status === "VALID" ? "Draft is structurally valid" : `${errorCount} issue${errorCount === 1 ? "" : "s"} before publication`}</h2>
              </div>
              <button type="button" onClick={() => setValidationOpen(false)} className="text-[var(--muted-ink)]">×</button>
            </div>
            {validation.issues.length ? (
              <ul className="mt-4 max-h-64 space-y-3 overflow-auto border-t border-[var(--line)] pt-4">
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.elementId ?? index}`} className="grid grid-cols-[0.75rem_1fr] gap-2 text-[0.6875rem] leading-5">
                    <span className={`mt-1.5 size-1.5 rounded-full ${issue.severity === "ERROR" ? "bg-[var(--danger)]" : "bg-[var(--gold)]"}`} />
                    <span><span className="font-semibold">{issue.message}</span>{issue.elementId ? <span className="mt-0.5 block font-mono text-[0.6rem] text-[var(--faint-ink)]">{issue.elementId}</span> : null}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-xs text-[var(--muted-ink)]">No validation issues were found.</p>}
          </section>
        ) : null}

        {inspectorOpen ? (
          <aside className="absolute inset-y-0 right-0 z-20 w-[min(320px,92vw)] overflow-auto border-l border-[var(--line)] bg-[var(--paper-glass-97)] shadow-lg backdrop-blur-xl lg:static lg:shadow-none">
            <div className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-[var(--line)] bg-[var(--paper-glass-94)] px-4 backdrop-blur-xl">
              <div className="flex items-baseline gap-2"><p className="text-xs font-semibold">{selected ? selected.type : "Process"}</p><p className="font-mono text-[0.58rem] text-[var(--faint-ink)]">{selected?.id ?? artifact.key}</p></div>
              <Button variant="quiet" size="icon-sm" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><PanelRightClose className="size-4" /></Button>
            </div>
            <div className="divide-y divide-[var(--line)] px-4">
              <section className="py-5">
                <label htmlFor="element-name" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Name</label>
                <input id="element-name" value={selected?.name ?? artifact.name} readOnly className="h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 text-sm font-semibold outline-none focus:border-[var(--signal)]" />
                <p className="mt-2 truncate font-mono text-[0.625rem] text-[var(--faint-ink)]">{selected?.id ?? artifact.key}</p>
              </section>
              {selected?.type === "UserTask" ? <section className="py-5">
                <div className="mb-4 flex items-center justify-between"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Initial owner</p><p className="mt-1 text-xs text-[var(--muted-ink)]">Who receives this work first?</p></div><CircleHelp className="size-3.5 text-[var(--faint-ink)]" /></div>
                <select aria-label="Initial task owner" value={taskOwner} onChange={(event) => applyTaskOwner(event.target.value)} className="h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-xs font-semibold outline-none focus:border-[var(--signal)]">
                  <option value="starter">Person who starts the process</option>
                  {taskOwners.groups.length ? <optgroup label="Team queues">{taskOwners.groups.map((group) => <option key={group.id} value={`group:${group.key}`}>{group.name} · claimable</option>)}</optgroup> : null}
                  {taskOwners.people.length ? <optgroup label="People">{taskOwners.people.map((person) => <option key={person.id} value={`person:${person.email}`}>{person.displayName}</option>)}</optgroup> : null}
                </select>
                <p className="mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">{taskOwner.startsWith("group:") ? "Everyone in this team sees the work; the first person to claim it becomes the owner." : "Once work is running, owners can hand the task over and set its due date from My work."}</p>
              </section> : null}
              {selected?.type === "UserTask" ? (
                <section className="py-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Task form</p><p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Collect structured work without coupling the process to a mutable draft.</p></div>
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--faint-ink)]" />
                  </div>
                  <select aria-label="Task form" value={formKey} onChange={(event) => setFormKey(event.target.value)} className="mt-4 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-xs font-semibold outline-none focus:border-[var(--signal)]">
                    <option value="">No form attached</option>
                    {forms.map((form) => <option key={form.id} value={form.key}>{form.name}</option>)}
                  </select>
                  {formKey ? (
                    <>
                      <details className="group mt-4 rounded-xl bg-[var(--wash)] px-3 py-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-[0.6875rem] font-bold">Data mapping <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                        <label className="mt-4 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Into the form</label>
                        <textarea value={inputMapping} onChange={(event) => setInputMapping(event.target.value)} rows={3} placeholder={"formField = processVariable"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                        <label className="mt-4 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Back to the process</label>
                        <textarea value={outputMapping} onChange={(event) => setOutputMapping(event.target.value)} rows={3} placeholder={"processVariable = formField"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                      </details>
                      {mappingError ? <p className="mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                    </>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between">
                    {forms.find((form) => form.key === formKey) ? <Link href={`/forms/${forms.find((form) => form.key === formKey)!.id}`} prefetch={false} className="text-[0.6875rem] font-bold text-[var(--signal)]">Open form</Link> : <span className="text-[0.625rem] text-[var(--faint-ink)]">{forms.length ? "Optional" : "Create a form in Library first"}</span>}
                    <Button variant="outline" size="sm" onClick={applyFormBinding}>Apply</Button>
                  </div>
                </section>
              ) : null}
              {selected?.type === "ServiceTask" ? (
                <section className="py-6">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Worker job</p><p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Hand this step to application code, outside the process engine.</p></div>
                    <Code2 className="mt-0.5 size-3.5 shrink-0 text-[var(--signal)]" />
                  </div>
                  <label className="mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Job type</label>
                  <input value={jobType} onChange={(event) => setJobType(event.target.value)} placeholder="invoice.send" className="mt-1 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 font-mono text-xs outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
                  <p className="mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">Workers subscribe to this stable, lowercase contract.</p>

                  {jobType ? <details className="group mt-5 border-y border-[var(--line)] py-1">
                    <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[0.6875rem] font-bold">Payload & delivery <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                    <div className="pb-4">
                      <label className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Into the job</label>
                      <textarea value={jobInputMapping} onChange={(event) => setJobInputMapping(event.target.value)} rows={3} placeholder={"payloadField = processVariable"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                      <label className="mt-4 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Back to the process</label>
                      <textarea value={jobOutputMapping} onChange={(event) => setJobOutputMapping(event.target.value)} rows={3} placeholder={"processVariable = resultField"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                      <label className="mt-4 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Static headers</label>
                      <textarea value={jobHeaders} onChange={(event) => setJobHeaders(event.target.value)} rows={2} placeholder={'region = "west"'} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                      <div className="mt-5 grid grid-cols-3 gap-3">
                        <label className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[var(--faint-ink)]">Lease<input value={jobLockDuration} onChange={(event) => setJobLockDuration(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 font-mono text-[0.625rem] text-[var(--ink)] outline-none focus:border-[var(--signal)]" /></label>
                        <label className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[var(--faint-ink)]">Attempts<input type="number" min={1} max={20} value={jobMaxAttempts} onChange={(event) => setJobMaxAttempts(Number(event.target.value))} className="mt-2 h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 font-mono text-[0.625rem] text-[var(--ink)] outline-none focus:border-[var(--signal)]" /></label>
                        <label className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[var(--faint-ink)]">Backoff<input value={jobRetryBackoff} onChange={(event) => setJobRetryBackoff(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 font-mono text-[0.625rem] text-[var(--ink)] outline-none focus:border-[var(--signal)]" /></label>
                      </div>
                    </div>
                  </details> : null}
                  {mappingError ? <p className="mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                  <div className="mt-5 flex items-center justify-between"><span className="text-[0.625rem] text-[var(--faint-ink)]">ISO-8601 durations</span><Button variant="outline" size="sm" onClick={applyJobBinding}>Apply</Button></div>
                </section>
              ) : null}
              {selected?.type === "BusinessRuleTask" ? (
                <section className="relative py-6">
                  <span className="absolute -right-8 top-2 size-24 rounded-full bg-[var(--gold-wash)] blur-2xl" aria-hidden="true" />
                  <div className="relative flex items-start justify-between gap-3"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">Decide</p><p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Evaluate a reviewed decision revision and keep its evidence with this instance.</p></div><Scale className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" /></div>
                  <select aria-label="DMN decision" value={decisionKey} onChange={(event) => setDecisionKey(event.target.value)} className="relative mt-5 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-xs font-semibold outline-none focus:border-[var(--signal)]"><option value="">No decision attached</option>{decisions.map((decision) => <option key={decision.id} value={decision.key}>{decision.name}</option>)}</select>
                  {decisionKey ? <details className="group relative mt-5 border-y border-[var(--line)] py-1"><summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[0.6875rem] font-bold">Data mapping <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="pb-4"><label className="block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Into the decision</label><textarea value={decisionInputMapping} onChange={(event) => setDecisionInputMapping(event.target.value)} rows={3} placeholder={"decisionInput = processVariable"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" /><label className="mt-4 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Back to the process</label><textarea value={decisionOutputMapping} onChange={(event) => setDecisionOutputMapping(event.target.value)} rows={3} placeholder={"processVariable = decisionOutput"} className="mt-2 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" /></div></details> : null}
                  {mappingError ? <p className="relative mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                  <div className="relative mt-5 flex items-center justify-between">{decisions.find((decision) => decision.key === decisionKey) ? <Link href={`/decisions/${decisions.find((decision) => decision.key === decisionKey)!.id}`} prefetch={false} className="text-[0.6875rem] font-bold text-[var(--signal)]">Open decision</Link> : <span className="text-[0.625rem] text-[var(--faint-ink)]">{decisions.length ? "Choose one decision" : "Create a decision first"}</span>}<Button variant="outline" size="sm" onClick={applyDecisionBinding}>Apply decision</Button></div>
                </section>
              ) : null}
              {selected?.type === "IntermediateCatchEvent" && selected.catchKind !== "MESSAGE" ? (
                <section className="relative py-6">
                  <span className="absolute -right-7 top-1 size-24 rounded-full bg-[var(--gold-wash)] blur-2xl" aria-hidden="true" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">Pause</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Let the process rest here, then continue automatically.</p>
                    </div>
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" />
                  </div>
                  <div className="relative mt-5 grid grid-cols-2 border-b border-[var(--line-strong)]" role="radiogroup" aria-label="Timer kind">
                    <button type="button" role="radio" aria-checked={timerType === "DURATION"} onClick={() => { setTimerType("DURATION"); if (timerType !== "DURATION") setTimerExpression("PT15M"); }} className={`pb-2.5 text-left text-xs font-semibold ${timerType === "DURATION" ? "border-b-2 border-[var(--ink)] text-[var(--ink)]" : "text-[var(--faint-ink)]"}`}>For a while</button>
                    <button type="button" role="radio" aria-checked={timerType === "DATE"} onClick={() => { setTimerType("DATE"); if (timerType !== "DATE") setTimerExpression("2030-06-02T08:30:00Z"); }} className={`pb-2.5 text-left text-xs font-semibold ${timerType === "DATE" ? "border-b-2 border-[var(--ink)] text-[var(--ink)]" : "text-[var(--faint-ink)]"}`}>Until a moment</button>
                  </div>
                  <label htmlFor="timer-expression" className="relative mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">{timerType === "DURATION" ? "Duration" : "Exact moment"}</label>
                  <input id="timer-expression" value={timerExpression} onChange={(event) => setTimerExpression(event.target.value)} placeholder={timerType === "DURATION" ? "PT15M" : "2030-06-02T08:30:00Z"} className="relative mt-1 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 font-mono text-xs outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
                  <p className="relative mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">{timerType === "DURATION" ? "ISO-8601: PT30S, PT15M, P1D." : "Include Z or an explicit UTC offset. Studio will localize this later."}</p>
                  {mappingError ? <p className="relative mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                  <div className="relative mt-5 flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--faint-ink)]"><span className="size-1.5 rounded-full bg-[var(--moss)]" /> PostgreSQL clock</span>
                    <Button variant="outline" size="sm" onClick={applyTimerBinding}>Apply pause</Button>
                  </div>
                </section>
              ) : null}
              {selected?.type === "IntermediateCatchEvent" && selected.catchKind === "MESSAGE" ? (
                <section className="relative py-6">
                  <span className="absolute -right-8 top-2 size-24 rounded-full bg-[var(--moss-wash)] blur-2xl" aria-hidden="true" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--moss)]">Incoming message</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Continue when another app sends a message for this exact case.</p>
                    </div>
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-[var(--moss)]" />
                  </div>
                  <label htmlFor="message-name" className="relative mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Message name</label>
                  <input id="message-name" value={messageName} onChange={(event) => setMessageName(event.target.value)} placeholder="expense.approved" className="relative mt-1 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 font-mono text-xs outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
                  <p className="relative mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">A stable contract shared with the sending application.</p>
                  <label htmlFor="correlation-variable" className="relative mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Match using</label>
                  <div className="relative mt-1 flex items-center border-b border-[var(--line-strong)] focus-within:border-[var(--signal)]">
                    <span className="pr-2 text-[0.625rem] font-semibold text-[var(--faint-ink)]">Process variable</span>
                    <input id="correlation-variable" value={correlationKeyVariable} onChange={(event) => setCorrelationKeyVariable(event.target.value)} placeholder="expenseId" className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-right font-mono text-xs outline-none placeholder:text-[var(--faint-ink)]" />
                  </div>
                  <p className="relative mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">Its committed value identifies the one waiting process.</p>
                  <details className="group relative mt-5 border-y border-[var(--line)] py-1">
                    <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[0.6875rem] font-bold">API contract <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                    <div className="pb-4 text-[0.625rem] leading-5 text-[var(--muted-ink)]">
                      Send <code className="font-mono text-[var(--ink)]">POST /api/v1/messages/correlate</code> with the environment, message name, correlation value, payload, and an Idempotency-Key header.
                    </div>
                  </details>
                  {mappingError ? <p className="relative mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                  <div className="relative mt-5 flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--faint-ink)]"><span className="size-1.5 rounded-full bg-[var(--moss)]" /> One exact match</span>
                    <Button variant="outline" size="sm" onClick={applyMessageBinding}>Apply contract</Button>
                  </div>
                </section>
              ) : null}
              {selected?.type === "IntermediateThrowEvent" ? (
                <section className="relative py-6">
                  <span className="absolute -right-8 top-2 size-24 rounded-full bg-[var(--signal-wash)] blur-2xl" aria-hidden="true" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--signal)]">Send message</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">Tell another process or app that this moment happened.</p>
                    </div>
                    <Send className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
                  </div>
                  <label htmlFor="outbound-message-name" className="relative mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Message name</label>
                  <input id="outbound-message-name" value={messageName} onChange={(event) => setMessageName(event.target.value)} placeholder="expense.approved" className="relative mt-1 h-10 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 font-mono text-xs outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
                  <p className="relative mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">A stable contract shared with the receiving process.</p>
                  <label htmlFor="outbound-correlation-variable" className="relative mt-5 block text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--faint-ink)]">Identify the case with</label>
                  <div className="relative mt-1 flex items-center border-b border-[var(--line-strong)] focus-within:border-[var(--signal)]">
                    <span className="pr-2 text-[0.625rem] font-semibold text-[var(--faint-ink)]">Process variable</span>
                    <input id="outbound-correlation-variable" value={correlationKeyVariable} onChange={(event) => setCorrelationKeyVariable(event.target.value)} placeholder="expenseId" className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-right font-mono text-xs outline-none placeholder:text-[var(--faint-ink)]" />
                  </div>
                  <p className="relative mt-2 text-[0.625rem] leading-5 text-[var(--muted-ink)]">Its committed value is matched in the same environment.</p>
                  <details className="group relative mt-5 border-y border-[var(--line)] py-1">
                    <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[0.6875rem] font-bold">Payload <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                    <div className="pb-4">
                      <p className="text-[0.625rem] leading-5 text-[var(--muted-ink)]">Choose only the process values the receiver should see.</p>
                      <label htmlFor="outbound-message-payload" className="sr-only">Payload mapping</label>
                      <textarea id="outbound-message-payload" value={messagePayloadMapping} onChange={(event) => setMessagePayloadMapping(event.target.value)} rows={4} placeholder={"payloadField = processVariable"} className="mt-3 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 font-mono text-[0.625rem] leading-5 outline-none focus:border-[var(--signal)]" />
                    </div>
                  </details>
                  {mappingError ? <p className="relative mt-3 text-[0.625rem] leading-5 text-[var(--danger)]">{mappingError}</p> : null}
                  <div className="relative mt-5 flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--faint-ink)]"><span className="size-1.5 rounded-full bg-[var(--signal)]" /> Sent after checkpoint</span>
                    <Button variant="outline" size="sm" onClick={applyMessageThrowBinding}>Apply message</Button>
                  </div>
                </section>
              ) : null}
              <details className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold">Technical details<ChevronDown className="size-3.5 text-[var(--faint-ink)] transition-transform group-open:rotate-180" /></summary>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-[0.625rem] text-[var(--muted-ink)]"><dt>Artifact</dt><dd className="truncate text-right">{artifact.id}</dd><dt>Revision</dt><dd className="text-right">{artifact.revision.number}</dd><dt>SHA-256</dt><dd className="truncate text-right">{artifact.revision.contentSha256}</dd></dl>
              </details>
            </div>
          </aside>
        ) : (
          <Button variant="outline" size="icon" onClick={() => setInspectorOpen(true)} className="absolute right-4 top-4 z-10 bg-[var(--raised-glass-90)] shadow-sm backdrop-blur" aria-label="Open inspector"><PanelRightOpen className="size-4" /></Button>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper)] px-4 text-[0.625rem] font-semibold text-[var(--muted-ink)] sm:px-6">
        <button type="button" onClick={() => setValidationOpen(true)} className="flex items-center gap-2 hover:text-[var(--ink)]"><span className={`size-1.5 rounded-full ${validation.status === "VALID" ? "bg-[var(--moss)]" : "bg-[var(--gold)]"}`} /> {validation.status === "VALID" ? "Executable profile · valid" : `${errorCount} errors · ${warningCount} warnings`}</button>
        <span className="flex items-center gap-1.5"><Save className="size-3" /> Revision {artifact.revision.number} · PostgreSQL</span>
      </footer>

      {reviewPanelOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-28)] backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !reviewPending) setReviewPanelOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="review-request-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-30px_0_90px_rgba(27,26,23,0.16)]">
            <header className="flex items-start justify-between border-b border-[var(--line)] px-6 py-6 sm:px-8">
              <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Independent decision</p><h2 id="review-request-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.05em]">Invite careful eyes.</h2><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">Revision {artifact.revision.number} will be pinned exactly as it is now.</p></div>
              <button type="button" disabled={reviewPending} onClick={() => setReviewPanelOpen(false)} aria-label="Close review request" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-8 sm:px-8">
              <div className="flex items-center gap-3 border-b border-[var(--line)] pb-5"><span className="flex size-10 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><ShieldCheck className="size-4" /></span><div><p className="text-xs font-bold">Immutable review subject</p><p className="mt-1 font-mono text-[0.625rem] text-[var(--faint-ink)]">revision {artifact.revision.number} · {artifact.revision.contentSha256.slice(0, 12)}</p></div></div>
              <fieldset className="mt-8"><legend className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Assigned reviewers</legend><div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{reviewers.map((candidate) => <label key={candidate.id} className={`flex items-center gap-3 py-4 ${candidate.eligible ? "cursor-pointer" : "opacity-45"}`}><input type="checkbox" disabled={!candidate.eligible} checked={selectedReviewerIds.includes(candidate.id)} onChange={(event) => setSelectedReviewerIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} className="size-4 accent-[var(--signal)]" /><span className="flex size-8 items-center justify-center rounded-full bg-[var(--wash)] text-[var(--muted-ink)]"><UserRoundCheck className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold">{candidate.displayName}</span><span className="mt-1 block truncate text-[0.625rem] text-[var(--muted-ink)]">{candidate.role.replaceAll("-", " ")}{candidate.ineligibleReason ? ` · ${candidate.ineligibleReason}` : ""}</span></span></label>)}</div>{!reviewers.some((candidate) => candidate.eligible) ? <p className="mt-3 text-xs leading-5 text-[var(--danger)]">No independent reviewer is available in this workspace.</p> : null}</fieldset>
              <div className="mt-8"><label htmlFor="review-summary" className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Review brief <span className="normal-case tracking-normal">· optional</span></label><textarea id="review-summary" value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} maxLength={2000} rows={5} placeholder="What changed, and where should the reviewer look closely?" className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm leading-6 outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" /></div>
              {reviewError ? <p role="alert" className="mt-5 text-xs font-semibold leading-5 text-[var(--danger)]">{reviewError}</p> : null}
            </div>
            <footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><button type="button" disabled={reviewPending} onClick={() => setReviewPanelOpen(false)} className="text-xs font-bold text-[var(--muted-ink)]">Cancel</button><Button variant="signal" disabled={reviewPending || !selectedReviewerIds.length} onClick={() => void submitReview()}>{reviewPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send for review</Button></footer>
          </section>
        </div>
      ) : null}
      <StudioComments
        open={commentsOpen}
        review={review}
        selected={selected ? { id: selected.id, name: selected.name, type: selected.type } : null}
        onClose={() => setCommentsOpen(false)}
        onRequestReview={() => { setCommentsOpen(false); void openReviewPanel(); }}
        onReviewChange={setReview}
        onAnchorSelect={(elementId) => { canvasRef.current?.selectElement(elementId); setCommentsOpen(false); }}
      />
      <ProcessSimulation artifact={artifact} open={simulationOpen} onOpenChange={(open) => { setSimulationOpen(open); if (!open) setSimulationHighlight(null); }} onHighlight={setSimulationHighlight} />
    </div>
  );
}
