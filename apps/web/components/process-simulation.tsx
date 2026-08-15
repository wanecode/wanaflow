"use client";

import { useState } from "react";
import type { Artifact, DraftSimulationResult } from "@wanaflow/db";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CirclePlay,
  FlaskConical,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import { simulateDraft } from "@/lib/api-client";

function parseObject(value: string, label: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function waitCopy(wait: DraftSimulationResult["waits"][number]) {
  return {
    USER_TASK: "A person would complete this task",
    EXTERNAL_JOB: "An external worker would perform this step",
    TIMER: "The process would pause until its timer is due",
    MESSAGE: "The process would wait for a matching message",
  }[wait.kind];
}

export function ProcessSimulation({
  artifact,
  open,
  onOpenChange,
  onHighlight,
}: {
  artifact: Artifact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHighlight: (elementId: string | null) => void;
}) {
  const [variablesText, setVariablesText] = useState("{}");
  const [outputText, setOutputText] = useState("{}");
  const [result, setResult] = useState<DraftSimulationResult | null>(null);
  const [journey, setJourney] = useState<DraftSimulationResult["events"]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (continueRun = false) => {
    setPending(true);
    setError(null);
    try {
      const variables = continueRun && result
        ? result.variables as Record<string, unknown>
        : parseObject(variablesText, "Sample data");
      const wait = result?.waits[0];
      const next = await simulateDraft(artifact.id, {
        revisionId: artifact.revision.id,
        variables,
        ...(continueRun && result && wait
          ? {
              envelope: result.envelope,
              signal: { executionId: wait.executionId, output: parseObject(outputText, "Step result") },
            }
          : {}),
      });
      setResult(next);
      setJourney((current) => continueRun ? [...current, ...next.events] : next.events);
      setOutputText("{}");
      onHighlight(next.waits[0]?.elementId ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft could not be simulated.");
    } finally {
      setPending(false);
    }
  };

  const restart = () => {
    setResult(null);
    setJourney([]);
    setOutputText("{}");
    setError(null);
    onHighlight(null);
  };

  if (!open) return null;
  const wait = result?.waits[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-30)] backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) onOpenChange(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="simulation-title" className="flex h-full w-full max-w-[540px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-32px_0_100px_rgba(27,26,23,0.18)]">
        <header className="border-b border-[var(--line)] px-6 py-6 sm:px-8">
          <div className="flex items-start justify-between gap-5">
            <div><p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]"><FlaskConical className="size-3.5" /> Safe preview</p><h2 id="simulation-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Walk through this draft.</h2><p className="mt-3 max-w-md text-xs leading-5 text-[var(--muted-ink)]">Use sample data against saved revision {artifact.revision.number}. Nothing is deployed, assigned, or written to Operations.</p></div>
            <button type="button" onClick={() => onOpenChange(false)} aria-label="Close simulation" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-7 sm:px-8">
          {!result ? (
            <div className="space-y-7">
              <div><label htmlFor="simulation-input" className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Starting data · JSON object</label><textarea id="simulation-input" value={variablesText} onChange={(event) => setVariablesText(event.target.value)} rows={10} spellCheck={false} className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-[var(--ink)] p-4 font-mono text-[0.6875rem] leading-5 text-[#e7e3da] outline-none focus:border-[var(--signal)]" /></div>
              <div className="border-l-2 border-[var(--moss)] pl-4"><p className="text-xs font-bold">This uses the real execution profile</p><p className="mt-1 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Decision tables are evaluated and data mappings run exactly as they would after deployment. Human and external waits stay under your control.</p></div>
            </div>
          ) : (
            <div>
              <div className={`border-y border-[var(--line)] py-6 ${result.status === "COMPLETED" ? "text-[var(--moss)]" : "text-[var(--ink)]"}`}>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--faint-ink)]">{result.status === "COMPLETED" ? "Path complete" : `Paused · ${wait?.kind.replaceAll("_", " ").toLowerCase()}`}</p>
                <h3 className="font-editorial mt-2 text-3xl font-medium tracking-[-0.045em]">{result.status === "COMPLETED" ? "The sample reached its end." : wait?.elementName}</h3>
                {wait ? <p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">{waitCopy(wait)}</p> : null}
              </div>

              <section className="mt-7"><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Journey</p><ol className="mt-4 space-y-0">{journey.filter((event) => event.type === "ACTIVITY_ENTERED").map((event, index) => <li key={`${event.elementId}-${index}`} className="grid grid-cols-[1.5rem_1fr] gap-3"><div className="flex flex-col items-center"><span className={`mt-0.5 flex size-5 items-center justify-center rounded-full ${index === journey.filter((entry) => entry.type === "ACTIVITY_ENTERED").length - 1 && result.status === "WAITING" ? "bg-[var(--signal-wash)] text-[var(--signal)]" : "bg-[var(--moss-wash)] text-[var(--moss)]"}`}>{index === journey.filter((entry) => entry.type === "ACTIVITY_ENTERED").length - 1 && result.status === "WAITING" ? <CirclePlay className="size-3" /> : <Check className="size-3" />}</span>{index < journey.filter((entry) => entry.type === "ACTIVITY_ENTERED").length - 1 ? <span className="h-8 w-px bg-[var(--line)]" /> : null}</div><div className="pb-5"><p className="text-xs font-bold">{event.elementName}</p><p className="mt-1 text-[0.6rem] text-[var(--faint-ink)]">{event.elementType.replace("bpmn:", "")}</p></div></li>)}</ol></section>

              {result.decisionEvaluations.length ? <details className="group mt-5 border-t border-[var(--line)] pt-5"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold"><span className="flex items-center gap-2"><Sparkles className="size-3.5 text-[var(--gold)]" /> Decision evidence · {result.decisionEvaluations.length}</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="mt-4 space-y-4">{result.decisionEvaluations.map((evaluation) => <div key={evaluation.executionId} className="border-l border-[var(--gold)] pl-4"><p className="text-xs font-bold">{evaluation.decisionName}</p><p className="mt-1 font-mono text-[0.6rem] text-[var(--muted-ink)]">{evaluation.matchedRuleIds.length ? `matched ${evaluation.matchedRuleIds.join(", ")}` : "no rule matched"}</p><pre className="mt-2 overflow-auto text-[0.6rem] text-[var(--muted-ink)]">{JSON.stringify(evaluation.output, null, 2)}</pre></div>)}</div></details> : null}

              {wait ? <div className="mt-7"><label htmlFor="simulation-output" className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Result from this step · JSON object</label><textarea id="simulation-output" value={outputText} onChange={(event) => setOutputText(event.target.value)} rows={6} spellCheck={false} className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-[var(--ink)] p-4 font-mono text-[0.6875rem] leading-5 text-[#e7e3da] outline-none focus:border-[var(--signal)]" /></div> : null}
              <details className="group mt-6"><summary className="flex cursor-pointer list-none items-center gap-2 text-[0.6875rem] font-semibold text-[var(--muted-ink)]">Current sample data <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><pre className="mt-3 max-h-56 overflow-auto border-l border-[var(--line-strong)] pl-4 font-mono text-[0.625rem] leading-5 text-[var(--muted-ink)]">{JSON.stringify(result.variables, null, 2)}</pre></details>
            </div>
          )}
          {error ? <p role="alert" className="mt-6 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8">
          {result ? <Button variant="quiet" disabled={pending} onClick={restart}><RotateCcw className="size-3.5" /> Restart</Button> : <span className="text-[0.6rem] font-semibold text-[var(--faint-ink)]">Ephemeral · revision {artifact.revision.number}</span>}
          <Button variant="signal" disabled={pending || result?.status === "COMPLETED"} onClick={() => void run(Boolean(result))}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : result ? <ArrowRight className="size-3.5" /> : <CirclePlay className="size-3.5" />}{result ? "Continue path" : "Begin preview"}</Button>
        </footer>
      </section>
    </div>
  );
}
