"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  OrganizationLibrary,
  ProcessInstanceSummary,
  ProcessTask,
  ReviewListItem,
} from "@wanaflow/db";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  LoaderCircle,
  Play,
  Workflow,
} from "lucide-react";

import { loadInstances, loadLibrary, loadReviews, loadTasks } from "@/lib/api-client";
import { FirstRunGuide, onboardingStorageKey } from "./first-run-guide";

function relativeTime(value: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function TodayWorkspace({ firstName }: { firstName: string }) {
  const [library, setLibrary] = useState<OrganizationLibrary | null>(null);
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [tasks, setTasks] = useState<ProcessTask[]>([]);
  const [instances, setInstances] = useState<ProcessInstanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(onboardingStorageKey) === "1");
  const [renderedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void loadLibrary().then(async (nextLibrary) => {
      const [nextReviews, nextTasks, nextInstances] = await Promise.all([
        nextLibrary.permissions.includes("review:read") ? loadReviews() : Promise.resolve([] as ReviewListItem[]),
        nextLibrary.permissions.includes("task:read") ? loadTasks() : Promise.resolve([] as ProcessTask[]),
        nextLibrary.permissions.includes("instance:read") ? loadInstances() : Promise.resolve([] as ProcessInstanceSummary[]),
      ]);
      if (!active) return;
      setLibrary(nextLibrary);
      setReviews(nextReviews);
      setTasks(nextTasks);
      setInstances(nextInstances);
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const artifacts = useMemo(
    () => library?.workspaces.flatMap((workspace) => workspace.projects).flatMap((project) => project.artifacts) ?? [],
    [library],
  );
  const openReviews = reviews.filter((review) => review.status === "OPEN");
  const activeInstances = instances.filter((instance) => !new Set(["COMPLETED", "CANCELLED"]).has(instance.status));
  const priorities = [
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      href: "/inbox",
      label: task.elementName,
      detail: `${task.processName}${task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}`,
      meta: task.dueAt && new Date(task.dueAt).getTime() < renderedAt ? "Overdue" : task.priority === "NORMAL" ? "Ready" : task.priority,
      tone: task.dueAt && new Date(task.dueAt).getTime() < renderedAt ? "danger" : "gold",
      icon: Clock3,
    })),
    ...openReviews.map((review) => ({
      id: `review-${review.id}`,
      href: `/reviews/${review.id}`,
      label: `Review ${review.artifact.name}`,
      detail: `Revision ${review.revision.number}${review.unresolvedCommentCount ? ` · ${review.unresolvedCommentCount} open comment${review.unresolvedCommentCount === 1 ? "" : "s"}` : " · ready for judgment"}`,
      meta: relativeTime(review.createdAt, renderedAt),
      tone: "signal",
      icon: FileCheck2,
    })),
    ...activeInstances.filter((instance) => instance.status === "INCIDENT").map((instance) => ({
      id: `incident-${instance.id}`,
      href: `/operations/${instance.id}`,
      label: `Resolve ${instance.processName}`,
      detail: instance.currentElement?.name ?? "Runtime incident",
      meta: relativeTime(instance.updatedAt, renderedAt),
      tone: "danger",
      icon: CircleAlert,
    })),
  ].slice(0, 5);
  const recent = [...artifacts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);
  const sampleArtifact = artifacts.find((artifact) => artifact.key === "employee-onboarding" && artifact.type === "BPMN_PROCESS");
  const showOnboarding = Boolean(sampleArtifact && artifacts.length === 1 && !reviews.length && !tasks.length && !instances.length && !onboardingDismissed);
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date(renderedAt));
  const greeting = new Date(renderedAt).getHours() < 12 ? "morning" : new Date(renderedAt).getHours() < 18 ? "afternoon" : "evening";

  if (loading) return <div className="workspace-page flex min-h-full items-center justify-center gap-3 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Gathering today’s work</div>;

  const stages = [
    { href: "/library", number: artifacts.length, label: "Design", detail: "Processes, decisions, and forms", icon: Workflow },
    { href: "/reviews", number: openReviews.length, label: "Review", detail: "Revisions waiting for judgment", icon: FileCheck2 },
    { href: "/operations", number: activeInstances.length, label: "Run", detail: "Active process instances", icon: Play },
  ];

  return (
    <div className="workspace-page mx-auto w-full max-w-[1180px] px-5 pb-24 pt-8 sm:px-8 md:px-10 md:pb-12 md:pt-10">
      <header className="stagger-in flex flex-col gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-kicker">{dateLabel}</p>
          <h1 className="page-title mt-2">Good {greeting}, {firstName}.</h1>
          <p className="page-description mt-3">{priorities.length ? `${priorities.length} ${priorities.length === 1 ? "item needs" : "items need"} your attention.` : "Nothing needs immediate attention. Your workspace is moving quietly."}</p>
        </div>
        <Link href="/library" prefetch={false} className="inline-flex h-9 items-center gap-2 self-start rounded-[var(--radius)] border border-[var(--line-strong)] px-3 text-xs font-semibold hover:bg-[var(--wash)] sm:self-auto">Open Studio <ArrowRight className="size-3.5" /></Link>
      </header>

      {showOnboarding && sampleArtifact ? <FirstRunGuide sampleArtifactId={sampleArtifact.id} onDismiss={() => setOnboardingDismissed(true)} /> : null}

      <nav aria-label="Workspace journey" className="grid border-b border-[var(--line)] sm:grid-cols-3">
        {stages.map((stage, index) => <Link key={stage.label} href={stage.href} prefetch={false} className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-5 transition-colors hover:bg-[var(--wash-glass-55)] sm:px-4 ${index ? "border-t border-[var(--line)] sm:border-l sm:border-t-0" : ""}`}><stage.icon className="size-4 text-[var(--muted-ink)]" /><span className="min-w-0"><span className="block text-xs font-semibold">{stage.label}</span><span className="mt-1 block truncate text-[0.6875rem] text-[var(--muted-ink)]">{stage.detail}</span></span><span className="flex items-center gap-2"><strong className="text-xl font-semibold tracking-[-0.04em]">{stage.number}</strong><ChevronRight className="size-3.5 text-[var(--faint-ink)] transition-transform group-hover:translate-x-0.5" /></span></Link>)}
      </nav>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.72fr)] lg:gap-16">
        <section aria-labelledby="attention-heading">
          <div className="flex items-center justify-between border-b border-[var(--line-strong)] pb-3"><h2 id="attention-heading" className="text-sm font-semibold">Needs your attention</h2><span className="text-xs tabular-nums text-[var(--muted-ink)]">{priorities.length}</span></div>
          {priorities.length ? <div className="divide-y divide-[var(--line)]">{priorities.map((item) => { const Icon = item.icon; return <Link key={item.id} href={item.href} prefetch={false} className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-4"><span className={`flex size-8 items-center justify-center rounded-[var(--radius)] ${item.tone === "signal" ? "bg-[var(--signal-wash)] text-[var(--signal)]" : item.tone === "danger" ? "bg-[var(--danger-wash)] text-[var(--danger)]" : "bg-[var(--gold-wash)] text-[var(--gold)]"}`}><Icon className="size-3.5" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{item.label}</span><span className="mt-1 block truncate text-[0.6875rem] text-[var(--muted-ink)]">{item.detail}</span></span><span className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-ink)]"><span className="hidden sm:inline">{item.meta}</span><ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span></Link>; })}</div> : <div className="flex items-center gap-3 py-8"><span className="flex size-9 items-center justify-center rounded-[var(--radius)] bg-[var(--moss-wash)] text-[var(--moss)]"><Check className="size-4" /></span><div><p className="text-xs font-semibold">You are caught up.</p><p className="mt-1 text-[0.6875rem] text-[var(--muted-ink)]">No assigned tasks, reviews, or incidents.</p></div></div>}
        </section>

        <aside aria-labelledby="recent-heading"><div className="flex items-center justify-between border-b border-[var(--line-strong)] pb-3"><h2 id="recent-heading" className="text-sm font-semibold">Recent design work</h2><Link href="/library" prefetch={false} className="text-[0.6875rem] font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]">View all</Link></div><div className="divide-y divide-[var(--line)]">{recent.map((artifact) => <Link key={artifact.id} href={artifact.type === "FORM" ? `/forms/${artifact.id}` : artifact.type === "DMN_DECISION" ? `/decisions/${artifact.id}` : `/studio/${artifact.id}`} prefetch={false} className="group grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3.5"><span className="min-w-0"><span className="block truncate text-xs font-semibold">{artifact.name}</span><span className="mt-1 block truncate text-[0.6875rem] text-[var(--muted-ink)]">{artifact.type === "FORM" ? "Form" : artifact.type === "DMN_DECISION" ? "Decision" : "Process"} · revision {artifact.revision.number}</span></span><span className="text-[0.625rem] text-[var(--faint-ink)]">{relativeTime(artifact.updatedAt, renderedAt)}</span></Link>)}</div></aside>
      </div>

      {!artifacts.length ? <section className="mt-12 border-t border-[var(--line)] pt-7"><p className="text-sm font-semibold">Start with work your team already knows.</p><p className="page-description mt-2">A starter gives you a useful shape without hiding the underlying BPMN model.</p><Link href="/library?start=templates" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[var(--signal)]">Explore starter templates <ArrowRight className="size-3.5" /></Link></section> : null}
    </div>
  );
}
