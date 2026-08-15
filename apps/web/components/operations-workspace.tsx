"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProcessInstance, ProcessInstanceStatus, ProcessInstanceSummary, TaskAssigneeCandidate } from "@wanaflow/db";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Code2,
  LoaderCircle,
  MessageCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  Send,
  TerminalSquare,
  UserRound,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import { loadIncidentOwners, loadInstance, loadInstances, retryExternalJob, updateIncident } from "@/lib/api-client";

const statusCopy: Record<ProcessInstanceStatus, string> = {
  STARTING: "Starting",
  RUNNING: "Running",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  INCIDENT: "Needs intervention",
  CANCELLED: "Cancelled",
};

const eventCopy: Record<string, string> = {
  PROCESS_STARTED: "Process started",
  ELEMENT_ENTERED: "Element entered",
  ELEMENT_COMPLETED: "Element completed",
  TASK_AVAILABLE: "Task assigned",
  TASK_COMPLETED: "Task completed",
  JOB_AVAILABLE: "Worker job available",
  JOB_COMPLETED: "Worker job completed",
  TIMER_SCHEDULED: "Pause scheduled",
  TIMER_FIRED: "Pause ended",
  MESSAGE_SUBSCRIBED: "Listening for a message",
  MESSAGE_CORRELATED: "Message matched",
  MESSAGE_QUEUED: "Message ready to send",
  DECISION_EVALUATED: "Decision evaluated",
  PROCESS_COMPLETED: "Process completed",
};

function statusTone(status: ProcessInstanceStatus) {
  if (status === "COMPLETED") return "bg-[var(--moss)] text-[var(--moss)]";
  if (status === "INCIDENT") return "bg-[var(--danger)] text-[var(--danger)]";
  if (status === "WAITING") return "bg-[var(--gold)] text-[var(--gold)]";
  return "bg-[var(--signal)] text-[var(--signal)]";
}

function elapsed(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function until(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "Due now";
  if (seconds < 60) return `In ${seconds}s`;
  if (seconds < 3600) return `In ${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `In ${Math.ceil(seconds / 3600)}h`;
  return `In ${Math.ceil(seconds / 86_400)}d`;
}

export function OperationsWorkspace({ initialInstanceId }: { initialInstanceId?: string }) {
  const [instances, setInstances] = useState<ProcessInstanceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialInstanceId ?? null);
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [incidentOwners, setIncidentOwners] = useState<TaskAssigneeCandidate[]>([]);
  const [incidentOwnerId, setIncidentOwnerId] = useState("");
  const [incidentNote, setIncidentNote] = useState("");
  const [updatingIncident, setUpdatingIncident] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await loadInstances();
      const targetId = initialInstanceId ?? selectedId ?? next[0]?.id ?? null;
      setInstances(next);
      setSelectedId(targetId);
      setInstance(targetId ? await loadInstance(targetId) : null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Runtime state could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [initialInstanceId, selectedId]);

  useEffect(() => {
    let active = true;
    void loadInstances()
      .then(async (next) => {
        const targetId = initialInstanceId ?? next[0]?.id ?? null;
        const detail = targetId ? await loadInstance(targetId) : null;
        if (!active) return;
        setInstances(next);
        setSelectedId(targetId);
        setInstance(detail);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Runtime state could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [initialInstanceId]);

  useEffect(() => {
    if (!instance || !(
      new Set<ProcessInstanceStatus>(["STARTING", "RUNNING"]).has(instance.status) ||
      (instance.status === "WAITING" && (
        instance.timers.some((timer) => timer.status === "WAITING") ||
        instance.messageSubscriptions.some((subscription) => subscription.status === "WAITING")
      )) || instance.messageDeliveries.some((delivery) => delivery.status === "AVAILABLE" || delivery.status === "CLAIMED")
    )) return;
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [instance, refresh]);

  const headline = useMemo(() => {
    if (!instance) return "No runtime activity yet.";
    if (instance.status === "WAITING" && instance.messageSubscriptions.some((subscription) => subscription.status === "WAITING")) return `${instance.currentElement?.name ?? "This process"} is listening.`;
    if (instance.status === "WAITING" && instance.jobs.some((job) => job.status === "WAITING")) return `${instance.currentElement?.name ?? "A worker job"} is ready for code.`;
    if (instance.status === "WAITING" && instance.timers.some((timer) => timer.status === "WAITING")) return `${instance.currentElement?.name ?? "This process"} is resting.`;
    if (instance.status === "WAITING") return `${instance.currentElement?.name ?? "A task"} is waiting.`;
    if (instance.status === "COMPLETED") return `${instance.processName} is complete.`;
    if (instance.status === "INCIDENT") return "This instance needs intervention.";
    return `${instance.processName} is moving.`;
  }, [instance]);

  const retryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    setError(null);
    try {
      await retryExternalJob(jobId);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The job could not be retried.");
    } finally {
      setRetryingJobId(null);
    }
  };

  const openIncident = instance?.incidents.find((item) => item.status === "OPEN") ?? null;

  const prepareIncident = async () => {
    if (!openIncident || incidentOwners.length) return;
    try {
      setIncidentOwners(await loadIncidentOwners(openIncident.id));
      setIncidentOwnerId(openIncident.owner?.id ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Incident owners could not be loaded.");
    }
  };

  const saveIncident = async () => {
    if (!openIncident) return;
    setUpdatingIncident(true);
    setError(null);
    try {
      const updated = await updateIncident(openIncident.id, {
        ownerId: incidentOwnerId || null,
        note: incidentNote.trim() || null,
      });
      setInstance(updated);
      setIncidentNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The incident update could not be saved.");
    } finally {
      setUpdatingIncident(false);
    }
  };

  if (loading) return <div className="workspace-page flex min-h-full items-center justify-center gap-3 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Reading runtime checkpoints</div>;

  return (
    <div className="workspace-page grid min-h-full min-w-0 bg-[var(--paper)] xl:h-full xl:min-h-[680px] xl:grid-cols-[300px_minmax(0,1fr)] xl:overflow-hidden">
      <aside className="min-h-0 border-b border-[var(--line)] xl:overflow-auto xl:border-b-0 xl:border-r">
        <header className="border-b border-[var(--line)] px-6 pb-6 pt-8">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--faint-ink)]">Live truth</p><h1 className="font-editorial mt-2 text-[2.3rem] font-medium leading-none tracking-[-0.05em]">Instances</h1></div><button type="button" onClick={() => void refresh()} aria-label="Refresh instances" className="mt-1 flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]"><RefreshCw className="size-3.5" /></button></div>
          <p className="mt-4 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Durable checkpoints, explained in process language.</p>
        </header>
        <nav aria-label="Process instances" className="flex gap-2 overflow-x-auto px-5 py-3 xl:block xl:divide-y xl:divide-[var(--line)] xl:px-0 xl:py-0">
          {instances.map((item) => <Link key={item.id} href={`/operations/${item.id}`} prefetch={false} onClick={() => { setSelectedId(item.id); setInstance(null); setLoading(true); }} className={`min-w-[250px] px-4 py-4 transition-colors xl:block xl:min-w-0 xl:px-6 xl:py-5 ${item.id === selectedId ? "bg-[var(--wash)] shadow-[inset_3px_0_var(--signal)]" : "hover:bg-[var(--wash-glass-55)]"}`}><span className="flex items-center gap-2"><span className={`size-1.5 shrink-0 rounded-full ${statusTone(item.status).split(" ")[0]}`} /><span className="truncate text-xs font-bold">{item.processName}</span></span><span className="mt-2 block truncate text-[0.65rem] text-[var(--muted-ink)]">{item.businessKey ?? item.id.slice(0, 12)}</span><span className="mt-3 flex items-center justify-between text-[0.6rem] text-[var(--faint-ink)]"><span>{statusCopy[item.status]}</span><span>{elapsed(item.updatedAt)}</span></span></Link>)}
        </nav>
      </aside>

      {instance ? (
        <main className="min-h-0 overflow-auto">
          <div className="mx-auto w-full max-w-[1040px] px-5 pb-24 pt-9 sm:px-9 md:px-12 md:pt-12">
            <header className="mb-12 border-b border-[var(--line-strong)] pb-9">
              <div className={`mb-5 flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] ${statusTone(instance.status).split(" ")[1]}`}><span className={`size-2 rounded-full ${statusTone(instance.status).split(" ")[0]}`} />{statusCopy[instance.status]}</div>
              <h2 className="font-editorial max-w-3xl text-[clamp(2.8rem,6vw,5.2rem)] font-medium leading-[0.92] tracking-[-0.055em]">{headline}</h2>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">{instance.status === "WAITING" && instance.messageSubscriptions.some((subscription) => subscription.status === "WAITING") ? "The engine is safely checkpointed. PostgreSQL remembers the exact message contract and case; no process-local broker needs to stay alive." : instance.status === "WAITING" && instance.jobs.some((job) => job.status === "WAITING") ? "The engine is safely checkpointed while an application worker owns delivery. Leases and attempts remain outside the process checkpoint." : instance.status === "WAITING" && instance.timers.some((timer) => timer.status === "WAITING") ? "No worker is holding this pause in memory. PostgreSQL owns the wake-up moment and will offer one continuation when it arrives." : instance.status === "WAITING" ? "The engine is safely checkpointed. Completing the assigned task creates one accepted command for the worker to incorporate." : instance.status === "COMPLETED" && instance.messageDeliveries.some((delivery) => delivery.status === "AVAILABLE" || delivery.status === "CLAIMED") ? "The process checkpoint is complete. Its outbound message is being delivered independently and can retry without replaying the process." : instance.status === "COMPLETED" ? "Every visible event below belongs to a committed checkpoint." : instance.status === "INCIDENT" ? instance.incidents[0]?.message : "The worker is resolving the immutable deployment into its next stable state."}</p>
            </header>

            <div className="grid gap-14 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.65fr)] lg:gap-20">
              <section aria-labelledby="timeline-title">
                <div className="mb-7 flex items-end justify-between gap-5"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--faint-ink)]">Instance {instance.id.slice(0, 12)}…</p><h3 id="timeline-title" className="mt-1 text-lg font-semibold tracking-[-0.035em]">What happened</h3></div><span className="text-[0.6875rem] font-semibold text-[var(--muted-ink)]">revision {instance.revision}</span></div>
                {instance.events.length ? <ol className="relative ml-2 border-l border-[var(--line-strong)] pl-8">{instance.events.map((event, index) => <li key={event.id} className="relative pb-9 last:pb-2"><span className={`absolute -left-[2.55rem] top-0 flex size-5 items-center justify-center rounded-full border-4 border-[var(--paper)] ${event.type === "PROCESS_COMPLETED" || event.type === "TASK_COMPLETED" ? "bg-[var(--moss)] text-white" : event.type === "TASK_AVAILABLE" ? "bg-[var(--gold)] text-white" : "bg-[var(--ink)] text-white"}`}>{event.type.includes("COMPLETED") ? <Check className="size-2.5" /> : <Circle className="size-2.5 fill-current" />}</span><div className="flex items-start justify-between gap-4"><div><h4 className="text-sm font-semibold tracking-[-0.02em]">{eventCopy[event.type] ?? event.type}</h4><p className="mt-1 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{event.element?.name ?? (event.actor ? `by ${event.actor.displayName}` : "Runtime checkpoint")}{event.element ? ` · ${event.element.id}` : ""}</p>{event.actor && event.element ? <p className="mt-1 flex items-center gap-1.5 text-[0.625rem] text-[var(--faint-ink)]"><UserRound className="size-3" /> {event.actor.displayName}</p> : null}</div><time className="font-mono text-[0.625rem] text-[var(--faint-ink)]">{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><span className="sr-only">Event {index + 1}</span></li>)}</ol> : <div className="border-y border-[var(--line)] py-10 text-sm text-[var(--muted-ink)]">The start command is accepted. The first checkpoint will appear here shortly.</div>}
              </section>

              <aside>
                <div className="border-b border-[var(--line-strong)] pb-4"><p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--faint-ink)]">Current state</p><h3 className="mt-1 text-lg font-semibold tracking-[-0.035em]">{instance.currentElement?.name ?? statusCopy[instance.status]}</h3></div>
                <dl className="divide-y divide-[var(--line)] text-xs">
                  <div className="flex items-center justify-between py-4"><dt className="text-[var(--muted-ink)]">Environment</dt><dd className="font-semibold">{instance.environment.name}</dd></div>
                  <div className="flex items-center justify-between py-4"><dt className="text-[var(--muted-ink)]">Business key</dt><dd className="max-w-[170px] truncate font-mono text-[0.6875rem]">{instance.businessKey ?? "—"}</dd></div>
                  <div className="flex items-center justify-between py-4"><dt className="text-[var(--muted-ink)]">Started by</dt><dd className="font-semibold">{instance.startedBy.displayName}</dd></div>
                  <div className="flex items-center justify-between py-4"><dt className="text-[var(--muted-ink)]">Updated</dt><dd className="font-semibold">{elapsed(instance.updatedAt)}</dd></div>
                </dl>

                {openIncident ? (
                  <section className="mt-8 border-l-2 border-[var(--danger)] pl-4 pr-1" aria-label="Incident recovery">
                    <p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--danger)]"><AlertTriangle className="size-3" /> Recovery desk</p>
                    <h4 className="mt-2 text-sm font-semibold">A person owns the next decision.</h4>
                    <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{openIncident.message}</p>
                    <label className="mt-4 block text-[0.625rem] font-bold text-[var(--muted-ink)]">Owner
                      <select value={incidentOwnerId} onFocus={() => void prepareIncident()} onChange={(event) => setIncidentOwnerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 text-xs font-semibold outline-none focus:border-[var(--signal)]">
                        <option value="">Operations queue</option>
                        {incidentOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
                      </select>
                    </label>
                    <label className="mt-3 block text-[0.625rem] font-bold text-[var(--muted-ink)]">Recovery note
                      <textarea value={incidentNote} onChange={(event) => setIncidentNote(event.target.value)} maxLength={2000} rows={3} placeholder="What did you learn or decide?" className="mt-1.5 w-full resize-none rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-2 text-xs outline-none focus:border-[var(--signal)]" />
                    </label>
                    <Button variant="outline" size="sm" className="mt-3 w-full" disabled={updatingIncident} onClick={() => void saveIncident()}>{updatingIncident ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save recovery context</Button>
                    {openIncident.notes.length ? <ol className="mt-4 space-y-3 border-t border-[var(--line)] pt-3">{openIncident.notes.map((note) => <li key={note.id} className="text-[0.625rem] leading-4"><p><strong>{note.author.displayName}</strong> · {note.action.toLowerCase().replace("_", " ")}</p>{note.body ? <p className="mt-0.5 text-[var(--muted-ink)]">{note.body}</p> : null}</li>)}</ol> : null}
                  </section>
                ) : null}

                {instance.decisionEvaluations.map((evaluation) => (
                  <section key={evaluation.id} className="relative mt-8 overflow-hidden border-l-2 border-[var(--gold)] pl-4 pr-1" aria-label="Decision evidence">
                    <span className="absolute -right-4 top-0 size-16 rounded-full bg-[var(--gold-wash)] blur-xl" aria-hidden="true" />
                    <div className="relative flex items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--gold)]"><Scale className="size-3" /> Decision evidence</p><h4 className="mt-2 text-sm font-semibold">{evaluation.decision.name}</h4></div><span className={`mt-1 size-2 rounded-full ${evaluation.outcome === "MATCHED" ? "bg-[var(--moss)]" : "bg-[var(--gold)]"}`} /></div>
                    <dl className="relative mt-4 space-y-2 text-[0.6875rem]"><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Outcome</dt><dd className="font-semibold">{evaluation.outcome === "MATCHED" ? "Rule matched" : "No rule matched"}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Decision</dt><dd className="font-mono text-[0.625rem]">{evaluation.decisionKey}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Rules</dt><dd className="font-mono text-[0.625rem]">{evaluation.matchedRuleIds.join(", ") || "—"}</dd></div></dl>
                    <details className="group relative mt-4"><summary className="flex cursor-pointer list-none items-center justify-between border-t border-[var(--line)] py-3 text-[0.6875rem] font-bold">Inputs & result <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="space-y-3 pb-2 font-mono text-[0.6rem] leading-5 text-[var(--muted-ink)]"><div><p className="font-sans font-bold text-[var(--ink)]">Input</p><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(evaluation.input, null, 2)}</pre></div><div><p className="font-sans font-bold text-[var(--ink)]">Output</p><pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(evaluation.output, null, 2)}</pre></div><p>version {evaluation.decisionArtifactVersionId}</p><p>checkpoint {evaluation.source?.checkpointRevision ?? "external"}</p></div></details>
                  </section>
                ))}

                {instance.jobs.filter((job) => job.status === "WAITING").map((job) => {
                  const latest = job.deliveries[0];
                  const openIncident = instance.incidents.find((incident) => incident.status === "OPEN" && incident.jobId === job.id);
                  return (
                    <section key={job.id} className="mt-8 border-l-2 border-[var(--signal)] pl-4 pr-1" aria-label="External job delivery">
                      <div className="flex items-start justify-between gap-4">
                        <div><p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--signal)]"><TerminalSquare className="size-3" /> Worker job</p><h4 className="mt-2 font-mono text-xs font-bold">{job.jobType}</h4></div>
                        <span className={`mt-0.5 size-2 rounded-full ${openIncident ? "bg-[var(--danger)]" : latest?.status === "LOCKED" ? "bg-[var(--gold)]" : "bg-[var(--moss)]"}`} />
                      </div>
                      <dl className="mt-4 space-y-2 text-[0.6875rem]">
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Delivery</dt><dd className="text-right font-semibold">{openIncident ? "Retries exhausted" : latest?.status === "LOCKED" ? `Locked by ${latest.workerId}` : latest?.status === "AVAILABLE" ? "Available" : latest?.status ?? "Preparing"}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Attempt</dt><dd className="font-mono">{latest?.cycleAttempt ?? 1} / {job.maxAttempts}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Effect key</dt><dd className="font-mono text-[0.625rem]">{job.effectKey.slice(0, 12)}…</dd></div>
                      </dl>
                      <details className="group mt-4">
                        <summary className="flex cursor-pointer list-none items-center justify-between border-t border-[var(--line)] py-3 text-[0.6875rem] font-bold">Delivery history <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                        <ol className="space-y-3 pb-2">{job.deliveries.map((delivery) => <li key={delivery.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 text-[0.625rem]"><span className={`mt-1 size-1.5 rounded-full ${delivery.status === "FAILED" ? "bg-[var(--danger)]" : delivery.status === "SUCCEEDED" ? "bg-[var(--moss)]" : "bg-[var(--gold)]"}`} /><span><span className="font-bold">Attempt {delivery.attempt} · {delivery.status.toLowerCase()}</span>{delivery.failure ? <span className="mt-0.5 block leading-4 text-[var(--muted-ink)]">{delivery.failure.message}</span> : null}</span><time className="font-mono text-[var(--faint-ink)]">{elapsed(delivery.createdAt)}</time></li>)}</ol>
                      </details>
                      {openIncident ? <Button variant="outline" size="sm" disabled={retryingJobId === job.id} onClick={() => void retryJob(job.id)} className="mt-4 w-full">{retryingJobId === job.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Start a fresh retry cycle</Button> : null}
                    </section>
                  );
                })}

                {instance.timers.filter((timer) => timer.status === "WAITING").map((timer) => (
                  <section key={timer.id} className="relative mt-8 overflow-hidden border-l-2 border-[var(--gold)] pl-4 pr-1" aria-label="Durable timer">
                    <span className="absolute -right-4 top-0 size-16 rounded-full bg-[var(--gold-wash)] blur-xl" aria-hidden="true" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--gold)]"><Clock3 className="size-3" /> Durable pause</p>
                        <h4 className="mt-2 text-sm font-semibold">{timer.completionPending ? "Waking the process" : until(timer.dueAt)}</h4>
                      </div>
                      <span className={`mt-1 size-2 rounded-full ${timer.completionPending ? "animate-pulse bg-[var(--signal)]" : "bg-[var(--gold)]"}`} />
                    </div>
                    <dl className="relative mt-4 space-y-2 text-[0.6875rem]">
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Continues</dt><dd className="text-right font-semibold">{new Date(timer.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Rule</dt><dd className="font-mono text-[0.625rem]">{timer.expression}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Authority</dt><dd className="font-semibold">PostgreSQL</dd></div>
                    </dl>
                    <p className="relative mt-4 border-t border-[var(--line)] pt-3 text-[0.625rem] leading-5 text-[var(--muted-ink)]">{timer.completionPending ? "The wake-up won the race. Its command is waiting for the next fenced checkpoint." : "The runtime can restart freely; this timestamp remains the single source of truth."}</p>
                  </section>
                ))}

                {instance.messageSubscriptions.filter((subscription) => subscription.status === "WAITING").map((subscription) => (
                  <section key={subscription.id} className="relative mt-8 overflow-hidden border-l-2 border-[var(--moss)] pl-4 pr-1" aria-label="Message subscription">
                    <span className="absolute -right-4 top-0 size-16 rounded-full bg-[var(--moss-wash)] blur-xl" aria-hidden="true" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--moss)]"><MessageCircle className="size-3" /> Incoming message</p>
                        <h4 className="mt-2 text-sm font-semibold">{subscription.completionPending ? "Match accepted" : "Listening"}</h4>
                      </div>
                      <span className={`mt-1 size-2 rounded-full ${subscription.completionPending ? "animate-pulse bg-[var(--signal)]" : "bg-[var(--moss)]"}`} />
                    </div>
                    <dl className="relative mt-4 space-y-2 text-[0.6875rem]">
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Message</dt><dd className="font-mono text-[0.625rem]">{subscription.messageName}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">This case</dt><dd className="max-w-[170px] truncate font-mono text-[0.625rem]">{subscription.correlationKey}</dd></div>
                      <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Environment</dt><dd className="font-semibold">{subscription.environment.name}</dd></div>
                    </dl>
                    <p className="relative mt-4 border-t border-[var(--line)] pt-3 text-[0.625rem] leading-5 text-[var(--muted-ink)]">{subscription.completionPending ? "One sender won the match. Its payload remains an accepted overlay until the next fenced checkpoint." : "Send the environment, message name, and this case value to the correlation API. Zero or multiple matches never consume this wait."}</p>
                    <details className="group relative mt-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[0.625rem] font-bold">Developer contract <ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary>
                      <code className="block break-all pb-2 font-mono text-[0.6rem] leading-5 text-[var(--muted-ink)]">POST /api/v1/messages/correlate · Idempotency-Key required</code>
                    </details>
                  </section>
                ))}

                {instance.messageDeliveries.map((delivery) => {
                  const active = delivery.status === "AVAILABLE" || delivery.status === "CLAIMED";
                  const delivered = delivery.status === "DELIVERED";
                  const title = delivered
                    ? "Delivered"
                    : delivery.status === "NO_MATCH"
                      ? "No listener found"
                      : delivery.status === "AMBIGUOUS"
                        ? "More than one listener"
                        : delivery.status === "CLAIMED"
                          ? "Finding the listener"
                          : delivery.attempts > 0
                            ? "Trying again"
                            : "Ready to send";
                  return (
                    <section key={delivery.id} className="relative mt-8 overflow-hidden border-l-2 border-[var(--signal)] pl-4 pr-1" aria-label="Outbound message delivery">
                      <span className="absolute -right-4 top-0 size-16 rounded-full bg-[var(--signal-wash)] blur-xl" aria-hidden="true" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div>
                          <p className="flex items-center gap-2 text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--signal)]"><Send className="size-3" /> Outbound message</p>
                          <h4 className="mt-2 text-sm font-semibold">{title}</h4>
                        </div>
                        <span className={`mt-1 size-2 rounded-full ${active ? "animate-pulse bg-[var(--gold)]" : delivered ? "bg-[var(--moss)]" : "bg-[var(--danger)]"}`} />
                      </div>
                      <dl className="relative mt-4 space-y-2 text-[0.6875rem]">
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Message</dt><dd className="font-mono text-[0.625rem]">{delivery.messageName}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Case</dt><dd className="max-w-[170px] truncate font-mono text-[0.625rem]">{delivery.correlationKey}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Attempts</dt><dd className="font-mono">{delivery.attempts}</dd></div>
                      </dl>
                      <p className="relative mt-4 border-t border-[var(--line)] pt-3 text-[0.625rem] leading-5 text-[var(--muted-ink)]">{delivered ? "Exactly one waiting subscription accepted this payload. Replays reuse the same correlation attempt." : delivery.status === "NO_MATCH" ? "No waiting process matched this message and case in the environment. Nothing was consumed." : delivery.status === "AMBIGUOUS" ? "Several waits matched, so Wanaflow left all of them untouched." : "The committed delivery intent is separate from engine state. A retry cannot replay the message throw."}</p>
                      <details className="group relative mt-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[0.625rem] font-bold">Delivery details <ChevronDown className="size-3 transition-transform group-open:rotate-180" /></summary>
                        <div className="space-y-2 pb-2 font-mono text-[0.6rem] leading-5 text-[var(--muted-ink)]"><p className="break-all">id {delivery.id}</p><p>checkpoint {delivery.checkpointRevision}</p><p className="break-all">payload {JSON.stringify(delivery.payload)}</p>{delivery.lastError ? <p className="text-[var(--danger)]">{delivery.lastError}</p> : null}</div>
                      </details>
                    </section>
                  );
                })}

                <details className="group mt-7">
                  <summary className="flex cursor-pointer list-none items-center justify-between border-y border-[var(--line)] py-4"><span className="flex items-center gap-2 text-xs font-semibold"><Code2 className="size-3.5" /> Variables</span><ChevronDown className="size-3.5 text-[var(--faint-ink)] transition-transform group-open:rotate-180" /></summary>
                  <dl className="divide-y divide-white/10 bg-[var(--ink)] px-4 py-2 font-mono text-[0.625rem] text-[#d8d4c9]">{Object.entries(instance.variables).map(([key, value]) => <div key={key} className="grid grid-cols-[0.55fr_1fr] gap-3 py-3"><dt className="text-[#ef9b80]">{key}</dt><dd className="break-all text-right">{JSON.stringify(value)}</dd></div>)}{!Object.keys(instance.variables).length ? <div className="py-3">No variables</div> : null}</dl>
                </details>

                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between border-y border-[var(--line)] py-4"><span className="flex items-center gap-2 text-xs font-semibold"><Clock3 className="size-3.5" /> Checkpoint</span><ChevronDown className="size-3.5 text-[var(--faint-ink)] transition-transform group-open:rotate-180" /></summary>
                  <div className="border-l border-[var(--line-strong)] py-3 pl-4 font-mono text-[0.625rem] leading-5 text-[var(--muted-ink)]">{instance.checkpoint ? <><p>{instance.checkpoint.adapter.name} {instance.checkpoint.adapter.engineVersion}</p><p>adapter {instance.checkpoint.adapter.version}</p><p>envelope {instance.checkpoint.envelopeSha256.slice(0, 16)}…</p><p>projection {instance.checkpoint.projectionSha256.slice(0, 16)}…</p></> : <p>No committed engine checkpoint yet.</p>}</div>
                </details>

                {instance.status === "WAITING" && !instance.jobs.some((job) => job.status === "WAITING") && !instance.timers.some((timer) => timer.status === "WAITING") && !instance.messageSubscriptions.some((subscription) => subscription.status === "WAITING") ? <Button asChild variant="signal" className="mt-8 w-full"><Link href="/inbox">Open assigned work <ArrowRight className="size-3.5" /></Link></Button> : null}
                {instance.status === "STARTING" || instance.status === "RUNNING" ? <p className="mt-8 flex items-center gap-2 text-[0.6875rem] font-semibold text-[var(--signal)]"><LoaderCircle className="size-3.5 animate-spin" /> Worker is advancing</p> : null}
              </aside>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex min-h-full items-center justify-center px-6 py-20 text-center"><div className="max-w-lg"><span className="mx-auto flex size-16 items-center justify-center rounded-full bg-[var(--signal-wash)] text-[var(--signal)]">{error ? <AlertTriangle className="size-7" /> : <Play className="size-7" />}</span><p className="mt-7 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Runtime</p><h2 className="font-editorial mt-3 text-5xl font-medium leading-none tracking-[-0.05em]">{error ? "The timeline is unavailable." : "Start with a deployment."}</h2><p className="mt-5 text-sm leading-6 text-[var(--muted-ink)]">{error ?? "Publish an approved process, deploy it to an environment, then start an instance from that immutable deployment."}</p><Button asChild variant="primary" className="mt-8"><Link href="/reviews">Open release desk <ArrowRight className="size-3.5" /></Link></Button></div></main>
      )}
    </div>
  );
}
