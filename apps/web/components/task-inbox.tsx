"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ProcessTask, TaskAssigneeCandidate } from "@wanaflow/db";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleCheck,
  FileJson2,
  LoaderCircle,
  CalendarClock,
  HandCoins,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import { claimTask, completeTask, loadTaskAssignees, loadTasks, updateTaskAssignment } from "@/lib/api-client";
import { TaskForm, type TaskFormHandle } from "./task-form";

function valueLabel(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null) return "—";
  return JSON.stringify(value);
}

export function TaskInbox() {
  const taskFormRef = useRef<TaskFormHandle>(null);
  const [tasks, setTasks] = useState<ProcessTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [completedTitle, setCompletedTitle] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignees, setAssignees] = useState<TaskAssigneeCandidate[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<ProcessTask["priority"]>("NORMAL");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [handoffTitle, setHandoffTitle] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await loadTasks();
      setTasks(next);
      setSelectedId((current) =>
        current && next.some((task) => task.id === current) ? current : next[0]?.id ?? null,
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Assigned work could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadTasks()
      .then((next) => {
        if (!active) return;
        setTasks(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Assigned work could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [selectedId, tasks],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || selected.completionPending) return;
    setPending(true);
    setError(null);
    try {
      let output: Record<string, unknown>;
      if (selected.form) {
        const formResult = taskFormRef.current?.submit();
        if (!formResult?.valid) {
          setError("Complete the required fields before submitting this task.");
          return;
        }
        output = formResult.data;
      } else {
        output = { outcome: "completed", ...(note.trim() ? { note: note.trim() } : {}) };
      }
      await completeTask(selected.id, output);
      setTasks((current) =>
        current.map((task) => task.id === selected.id ? { ...task, completionPending: true } : task),
      );
      const title = selected.elementName;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const next = await loadTasks();
        if (!next.some((task) => task.id === selected.id)) {
          setTasks(next);
          setSelectedId(next[0]?.id ?? null);
          setCompletedTitle(title);
          setNote("");
          return;
        }
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task could not be completed.");
    } finally {
      setPending(false);
    }
  };

  const openAssignment = async () => {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      setAssignees(await loadTaskAssignees(selected.id));
      setAssigneeId(selected.assignee?.id ?? "");
      setDueAt(selected.dueAt ? new Date(new Date(selected.dueAt).getTime() - new Date(selected.dueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
      setPriority(selected.priority);
      setAssignmentNote("");
      setAssignmentOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Assignment options could not be loaded.");
    } finally {
      setPending(false);
    }
  };

  const saveAssignment = async () => {
    if (!selected || !assigneeId) return;
    setPending(true);
    setError(null);
    try {
      const updated = await updateTaskAssignment(selected.id, {
        assigneeId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        priority,
        note: assignmentNote.trim() || null,
      });
      setAssignmentOpen(false);
      if (updated.assignee && updated.assignee.id !== selected.assignee?.id) {
        setHandoffTitle(`Handed to ${updated.assignee.displayName}`);
        await refresh();
      } else {
        setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assignment could not be updated.");
    } finally {
      setPending(false);
    }
  };

  const claimSelected = async () => {
    if (!selected?.claimable) return;
    setPending(true);
    setError(null);
    try {
      const updated = await claimTask(selected.id);
      setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This task could not be claimed.");
      await refresh();
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return <div className="workspace-page flex min-h-full items-center justify-center gap-3 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening your work</div>;
  }

  return (
    <div className="workspace-page grid min-h-full min-w-0 bg-[var(--paper)] lg:h-full lg:min-h-[640px] lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="min-w-0 border-b border-[var(--line)] lg:min-h-0 lg:overflow-auto lg:border-b-0 lg:border-r">
        <header className="border-b border-[var(--line)] px-5 pb-5 pt-7 sm:px-7">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--faint-ink)]">Assigned to you</p>
          <div className="mt-2 flex items-end justify-between">
            <h1 className="font-editorial text-[2.4rem] font-medium leading-none tracking-[-0.045em]">My work</h1>
            <button type="button" onClick={() => void refresh()} aria-label="Refresh tasks" className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]"><RefreshCw className="size-3.5" /></button>
          </div>
          <p className="mt-3 text-[0.6875rem] text-[var(--muted-ink)]">{tasks.length} open {tasks.length === 1 ? "task" : "tasks"}</p>
        </header>

        {tasks.length ? (
          <div className="flex gap-2 overflow-x-auto border-b border-[var(--line)] px-5 py-3 sm:px-7 lg:block lg:divide-y lg:divide-[var(--line)] lg:border-b-0 lg:px-0 lg:py-0">
            {tasks.map((task) => (
              <button key={task.id} type="button" onClick={() => { setSelectedId(task.id); setCompletedTitle(null); setNote(""); }} className={`min-w-[245px] px-4 py-4 text-left transition-colors lg:w-full lg:min-w-0 lg:px-7 lg:py-5 ${selectedId === task.id ? "bg-[var(--wash)] shadow-[inset_3px_0_var(--signal)]" : "hover:bg-[var(--wash-glass-55)]"}`}>
                <span className="block truncate text-xs font-bold tracking-[-0.02em]">{task.elementName}</span>
                <span className="mt-2 block truncate text-[0.6875rem] text-[var(--muted-ink)]">{task.processName}{task.businessKey ? ` · ${task.businessKey}` : ""}</span>
                <span className={`mt-3 flex items-center gap-1.5 text-[0.6rem] font-bold ${task.completionPending ? "text-[var(--gold)]" : task.dueAt && new Date(task.dueAt).getTime() < renderedAt ? "text-[var(--danger)]" : "text-[var(--moss)]"}`}><span className={`size-1.5 rounded-full ${task.completionPending ? "bg-[var(--gold)]" : task.dueAt && new Date(task.dueAt).getTime() < renderedAt ? "bg-[var(--danger)]" : "bg-[var(--moss)]"}`} />{task.completionPending ? "Completion queued" : task.dueAt && new Date(task.dueAt).getTime() < renderedAt ? "Overdue" : task.dueAt ? `Due ${new Date(task.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : "Ready"}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <section className="min-h-0 min-w-0 overflow-auto">
        {handoffTitle ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-20 text-center"><span className="mb-7 flex size-16 items-center justify-center rounded-full bg-[var(--gold-wash)] text-[var(--gold)]"><HandCoins className="size-7 stroke-[1.5]" /></span><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">Clear handoff</p><h2 className="font-editorial mt-3 text-5xl font-medium leading-none tracking-[-0.05em]">{handoffTitle}.</h2><p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted-ink)]">The task stays at the same process checkpoint. Its assignment history records who handed it over and when.</p>{tasks.length ? <Button variant="outline" className="mt-8" onClick={() => setHandoffTitle(null)}>Open my next task <ArrowRight className="size-3.5" /></Button> : null}</div>
        ) : completedTitle ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-20 text-center">
            <span className="mb-7 flex size-16 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><CheckCircle2 className="size-7 stroke-[1.5]" /></span>
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Checkpoint advanced</p>
            <h2 className="font-editorial mt-3 text-5xl font-medium leading-none tracking-[-0.05em]">{completedTitle} is done.</h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted-ink)]">Your submission is recorded in the instance timeline. The process has moved to its next stable state.</p>
            {tasks.length ? <Button variant="outline" className="mt-8" onClick={() => setCompletedTitle(null)}>Open next task <ArrowRight className="size-3.5" /></Button> : null}
          </div>
        ) : selected ? (
          <div className="mx-auto w-full max-w-[760px] px-5 pb-28 pt-8 sm:px-10 sm:pt-12 lg:px-14">
            <header className="mb-10 border-b border-[var(--line-strong)] pb-8">
              <div className="mb-5 flex items-center gap-2 text-[0.6875rem] font-semibold text-[var(--muted-ink)]"><span>{selected.processName}</span><ArrowRight className="size-3" /><span>Human task</span></div>
              <h1 className="font-editorial max-w-xl text-[clamp(2.6rem,6vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.05em]">{selected.elementName}</h1>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-[var(--muted-ink)]">
                {selected.assignee ? <button type="button" onClick={() => void openAssignment()} className="flex items-center gap-2 font-semibold hover:text-[var(--signal)]"><UserRound className="size-3.5" /> {selected.assignee.displayName} · manage</button> : <span className="flex items-center gap-2 font-semibold text-[var(--gold)]"><UserRound className="size-3.5" /> {selected.candidateGroup?.name ?? "Team queue"}</span>}
                <span className={`flex items-center gap-2 ${selected.dueAt && new Date(selected.dueAt).getTime() < renderedAt ? "font-bold text-[var(--danger)]" : ""}`}><CalendarClock className="size-3.5" /> {selected.dueAt ? `Due ${new Date(selected.dueAt).toLocaleString()}` : "No due date"}</span>
                {selected.priority !== "NORMAL" ? <span className="rounded-full bg-[var(--gold-wash)] px-2 py-1 text-[0.6rem] font-bold text-[var(--gold)]">{selected.priority.toLowerCase()} priority</span> : null}
              </div>
            </header>

            <form onSubmit={submit} className="space-y-9">
              {selected.form ? (
                <div>
                  <div className="mb-6 flex items-center justify-between border-b border-[var(--line)] pb-3"><p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--moss)]">Guided form</p><span className="font-mono text-[0.55rem] text-[var(--faint-ink)]">{selected.form.key} · {selected.form.schemaSha256.slice(0, 8)}</span></div>
                  <TaskForm key={selected.id} ref={taskFormRef} schema={selected.form.schema} data={selected.form.data} />
                </div>
              ) : <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--faint-ink)]">What needs attention</p><p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">Review the process data below, add any useful context, then complete this step. The accepted command will be incorporated by the runtime worker at the next checkpoint.</p></div>}

              <details className="group" open={!selected.form}>
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[var(--muted-ink)]"><FileJson2 className="size-3.5" /> Process context <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
              <dl className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                {Object.entries(selected.variables).slice(0, 6).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(110px,0.45fr)_1fr] gap-5 py-4 text-sm"><dt className="font-mono text-[0.6875rem] text-[var(--faint-ink)]">{key}</dt><dd className="break-words text-right font-semibold">{valueLabel(value)}</dd></div>)}
                {!Object.keys(selected.variables).length ? <div className="py-5 text-sm text-[var(--muted-ink)]">This instance has no input variables.</div> : null}
              </dl>
              </details>

              {!selected.form ? <label className="block">
                <span className="text-sm font-semibold tracking-[-0.02em]">Completion note <span className="font-normal text-[var(--faint-ink)]">(optional)</span></span>
                <textarea rows={4} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the timeline…" className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-[var(--paper-raised)] p-4 text-sm outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" />
              </label> : null}

              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[var(--muted-ink)]"><FileJson2 className="size-3.5" /> Technical context <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                <div className="mt-3 border-l border-[var(--line-strong)] pl-4 font-mono text-[0.625rem] leading-5 text-[var(--muted-ink)]"><p>instance {selected.instanceId}</p><p>element {selected.elementId}</p><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.variables, null, 2)}</pre></div>
              </details>

              {selected.assignmentHistory.length ? <details className="group"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-[var(--muted-ink)]"><HandCoins className="size-3.5" /> Assignment history · {selected.assignmentHistory.length} <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><ol className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{selected.assignmentHistory.map((entry) => <li key={entry.id} className="py-4 text-xs"><p><strong>{entry.changedBy.displayName}</strong> {entry.fromAssignee ? <>handed work from {entry.fromAssignee.displayName} to {entry.toAssignee.displayName}</> : <>claimed work for {entry.toAssignee.displayName}</>}.</p><p className="mt-1 text-[0.625rem] text-[var(--muted-ink)]">{new Date(entry.createdAt).toLocaleString()}{entry.note ? ` · ${entry.note}` : ""}</p></li>)}</ol></details> : null}

              {error ? <p role="alert" className="rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
              <div className="sticky bottom-[76px] flex items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--paper-glass-94)] py-4 backdrop-blur-xl md:bottom-0">
                <Link href={`/operations/${selected.instanceId}`} className="text-[0.6875rem] font-bold text-[var(--muted-ink)] hover:text-[var(--ink)]">View timeline</Link>
                {selected.claimable ? <Button type="button" variant="signal" size="lg" disabled={pending} onClick={() => void claimSelected()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <HandCoins className="size-4" />}Claim for me</Button> : <Button type="submit" variant="signal" size="lg" disabled={pending || selected.completionPending}>{pending || selected.completionPending ? <LoaderCircle className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}{selected.completionPending ? "Moving process…" : "Complete task"}</Button>}
              </div>
            </form>
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-20 text-center">
            <span className="mb-7 flex size-16 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><CircleCheck className="size-7 stroke-[1.5]" /></span>
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Inbox clear</p>
            <h2 className="font-editorial mt-3 text-5xl font-medium leading-none tracking-[-0.05em]">Nothing is waiting on you.</h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted-ink)]">New BPMN user tasks assigned to you will appear here at a durable checkpoint.</p>
            {error ? <p role="alert" className="mt-5 text-xs text-[var(--danger)]">{error}</p> : null}
            <Button variant="outline" className="mt-8" onClick={() => void refresh()}><RefreshCw className="size-3.5" /> Check again</Button>
          </div>
        )}
      </section>
      {assignmentOpen && selected ? <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-30)] backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) setAssignmentOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="assignment-title" className="flex h-full w-full max-w-[500px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-32px_0_100px_rgba(27,26,23,0.18)]"><header className="flex items-start justify-between border-b border-[var(--line)] px-6 py-7 sm:px-8"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">Work ownership</p><h2 id="assignment-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Make the handoff clear.</h2><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">The process remains paused at {selected.elementName}; only its human owner and timing change.</p></div><button type="button" onClick={() => setAssignmentOpen(false)} aria-label="Close assignment" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-7 overflow-auto px-6 py-7 sm:px-8"><div><label htmlFor="task-assignee" className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Responsible person</label><select id="task-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-3 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold outline-none focus:border-[var(--signal)]">{assignees.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.role.replaceAll("-", " ")}</option>)}</select></div><div className="grid gap-6 sm:grid-cols-2"><label className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-3 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-xs font-semibold normal-case tracking-normal outline-none focus:border-[var(--signal)]" /></label><label className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as ProcessTask["priority"])} className="mt-3 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-xs font-semibold normal-case tracking-normal outline-none focus:border-[var(--signal)]"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label></div><label className="block text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Handoff note · optional<textarea value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} rows={5} maxLength={1000} placeholder="What should the next person know?" className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm font-normal normal-case tracking-normal outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" /></label>{error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}</div><footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><Button variant="quiet" disabled={pending} onClick={() => setAssignmentOpen(false)}>Cancel</Button><Button variant="signal" disabled={pending || !assigneeId} onClick={() => void saveAssignment()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <HandCoins className="size-3.5" />} Save ownership</Button></footer></section></div> : null}
    </div>
  );
}
