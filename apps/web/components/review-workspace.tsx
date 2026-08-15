"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Deployment, Environment, Review, ReviewListItem } from "@wanaflow/db";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  GitCommitHorizontal,
  GitCompareArrows,
  History,
  LoaderCircle,
  MessageCircle,
  MessageSquarePlus,
  PackageCheck,
  Play,
  Rocket,
  Server,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import { BpmnCanvas, type SelectedElement } from "./bpmn-canvas";
import { DmnCanvas } from "./dmn-canvas";
import {
  addReviewComment,
  cancelReview,
  deployToEnvironment,
  loadProjectEnvironments,
  loadPublication,
  loadReview,
  loadReviews,
  publishReview,
  resolveReviewComment,
  submitReviewDecision,
  startInstance,
} from "@/lib/api-client";

type DetailTab = "brief" | "comments" | "activity";

const statusCopy = {
  OPEN: "Awaiting decision",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  CANCELLED: "Cancelled",
} as const;

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function activityCopy(action: string) {
  return {
    "review.requested": "requested this review",
    "review.comment-added": "anchored a comment",
    "review.comment-resolved": "resolved a comment",
    "review.approved": "approved the revision",
    "review.changes-requested": "requested changes",
    "review.cancelled": "cancelled the review",
    "publication.created": "sealed the approved publication",
    "deployment.created": "created an immutable deployment",
  }[action] ?? action.replace("review.", "").replaceAll("-", " ");
}

async function loadReviewDesk(preferredId?: string) {
  const queue = await loadReviews();
  const targetId = preferredId ?? queue[0]?.id;
  return {
    queue,
    detail: targetId ? await loadReview(targetId) : null,
  };
}

function ReviewEmpty() {
  return (
    <div className="workspace-page flex min-h-full items-center justify-center px-6 py-20 text-center">
      <div className="max-w-md">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><ShieldCheck className="size-6 stroke-[1.5]" /></span>
        <p className="mt-7 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Review desk</p>
        <h1 className="font-editorial mt-3 text-5xl font-medium tracking-[-0.055em]">Nothing needs judgment yet.</h1>
        <p className="mt-5 text-sm leading-6 text-[var(--muted-ink)]">When a saved revision is sent for approval, it will arrive here as an immutable review subject.</p>
        <Button asChild variant="primary" className="mt-8"><Link href="/library" prefetch={false}>Open the process library <ArrowRight className="size-3.5" /></Link></Button>
      </div>
    </div>
  );
}

export function ReviewWorkspace({ reviewId }: { reviewId?: string }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("brief");
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [mentionedPrincipalIds, setMentionedPrincipalIds] = useState<string[]>([]);
  const [decisionMode, setDecisionMode] = useState<"approve" | "changes" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [releaseMode, setReleaseMode] = useState<"publish" | "deploy" | "start" | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [deploymentNote, setDeploymentNote] = useState("");
  const [startDeployment, setStartDeployment] = useState<Deployment | null>(null);
  const [businessKey, setBusinessKey] = useState("");
  const [startVariables, setStartVariables] = useState("{}");

  const refresh = useCallback(async (preferredId?: string) => {
    const { queue, detail } = await loadReviewDesk(preferredId ?? reviewId);
    setError(null);
    setReviews(queue);
    if (!detail) {
      setReview(null);
      return;
    }
    setReview(detail);
    setSelected((current) => current ?? detail.elements.find((element) => !new Set(["Process", "SequenceFlow"]).has(element.type)) ?? null);
  }, [reviewId]);

  useEffect(() => {
    let active = true;
    void loadReviewDesk(reviewId)
      .then(({ queue, detail }) => {
        if (!active) return;
        setReviews(queue);
        setReview(detail);
        setSelected(detail?.elements.find((element) => !new Set(["Process", "SequenceFlow"]).has(element.type)) ?? null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "The review desk could not be opened.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reviewId]);

  const unresolvedComments = useMemo(
    () => review?.comments.filter((comment) => !comment.resolvedAt) ?? [],
    [review],
  );
  const reviewParticipants = useMemo(() => {
    if (!review) return [];
    const people = [review.requestedBy, ...review.assignments.map((assignment) => assignment.reviewer)];
    return people.filter((person, index) => people.findIndex((candidate) => candidate.id === person.id) === index);
  }, [review]);
  const highlightedChangeIds = useMemo(
    () => review?.changes.addedElements.map((element) => element.id) ?? [],
    [review],
  );

  const replaceReview = (next: Review) => {
    setReview(next);
    setReviews((current) => current.map((item) => item.id === next.id ? {
      ...item,
      status: next.status,
      decision: next.decision,
      publicationEligible: next.publicationEligible,
      publication: next.publication,
      capabilities: next.capabilities,
      commentCount: next.comments.length,
      unresolvedCommentCount: next.comments.filter((comment) => !comment.resolvedAt).length,
      decidedAt: next.decidedAt,
      cancelledAt: next.cancelledAt,
    } : item));
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!review || !selected) return;
    setPending(true);
    setActionError(null);
    try {
      replaceReview(await addReviewComment(review.id, {
        elementId: selected.id,
        body: commentBody,
        mentionedPrincipalIds,
      }));
      setCommentBody("");
      setMentionedPrincipalIds([]);
      setCommentOpen(false);
      setTab("comments");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The comment could not be added.");
    } finally {
      setPending(false);
    }
  };

  const resolveComment = async (commentId: string) => {
    if (!review) return;
    setPending(true);
    setActionError(null);
    try {
      replaceReview(await resolveReviewComment(review.id, commentId));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The comment could not be resolved.");
    } finally {
      setPending(false);
    }
  };

  const decide = async () => {
    if (!review || !decisionMode) return;
    setPending(true);
    setActionError(null);
    try {
      replaceReview(await submitReviewDecision(review.id, {
        outcome: decisionMode === "approve" ? "APPROVED" : "CHANGES_REQUESTED",
        ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
      }));
      setDecisionMode(null);
      setDecisionNote("");
      setTab("activity");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The decision could not be recorded.");
    } finally {
      setPending(false);
    }
  };

  const cancel = async () => {
    if (!review) return;
    setPending(true);
    setActionError(null);
    try {
      replaceReview(await cancelReview(review.id));
      setTab("activity");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The review could not be cancelled.");
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    if (!review) return;
    setPending(true);
    setActionError(null);
    try {
      await publishReview(review.id);
      replaceReview(await loadReview(review.id));
      setReleaseMode(null);
      setTab("activity");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The publication could not be created.");
    } finally {
      setPending(false);
    }
  };

  const openDeployment = async () => {
    if (!review?.publication) return;
    setReleaseMode("deploy");
    setPending(true);
    setActionError(null);
    try {
      const next = await loadProjectEnvironments(review.projectId);
      setEnvironments(next);
      setSelectedEnvironmentId(
        next.find((environment) => environment.key === "development")?.id ?? next[0]?.id ?? "",
      );
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Environments could not be loaded.");
    } finally {
      setPending(false);
    }
  };

  const deploy = async () => {
    if (!review?.publication || !selectedEnvironmentId) return;
    setPending(true);
    setActionError(null);
    try {
      const created = await deployToEnvironment(selectedEnvironmentId, {
        publicationId: review.publication.id,
        note: deploymentNote,
      });
      replaceReview(await loadReview(review.id));
      if (review.artifact.type === "BPMN_PROCESS") {
        setStartDeployment(created);
        setReleaseMode("start");
      } else {
        setReleaseMode(null);
      }
      setDeploymentNote("");
      setTab("activity");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The deployment could not be created.");
    } finally {
      setPending(false);
    }
  };

  const openStart = async () => {
    if (!review?.publication) return;
    setPending(true);
    setActionError(null);
    try {
      const publication = await loadPublication(review.publication.id);
      const deployment = publication.deployments[0];
      if (!deployment) throw new Error("Create a deployment before starting an instance.");
      setStartDeployment(deployment);
      setReleaseMode("start");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The deployment could not be loaded.");
    } finally {
      setPending(false);
    }
  };

  const start = async () => {
    if (!startDeployment) return;
    setPending(true);
    setActionError(null);
    try {
      const variables = JSON.parse(startVariables) as unknown;
      if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
        throw new Error("Variables must be a JSON object.");
      }
      const instance = await startInstance({
        deploymentId: startDeployment.id,
        ...(businessKey.trim() ? { businessKey: businessKey.trim() } : {}),
        variables: variables as Record<string, unknown>,
      });
      router.push(`/operations/${instance.id}`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The process instance could not be started.");
      setPending(false);
    }
  };

  if (loading) return <div className="flex min-h-full items-center justify-center gap-3 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening the review desk</div>;
  if (error) return <div className="workspace-page flex min-h-full items-center justify-center px-6 text-center"><div><p className="text-xs font-bold text-[var(--danger)]">Review desk unavailable</p><p className="mt-3 text-sm text-[var(--muted-ink)]">{error}</p><Button variant="outline" className="mt-6" onClick={() => void refresh()}>Try again</Button></div></div>;
  if (!review) return <ReviewEmpty />;

  const statusTone = review.status === "APPROVED" ? "text-[var(--moss)] bg-[var(--moss-wash)]" : review.status === "CHANGES_REQUESTED" ? "text-[var(--signal)] bg-[var(--signal-wash)]" : review.status === "CANCELLED" ? "text-[var(--faint-ink)] bg-[var(--wash)]" : "text-[var(--gold)] bg-[var(--gold-wash)]";

  return (
    <div className="workspace-page grid min-h-full xl:h-full xl:min-h-[680px] xl:grid-cols-[220px_minmax(0,1fr)] xl:overflow-hidden">
      <aside className="hidden min-h-0 border-r border-[var(--line)] bg-[var(--paper)] xl:flex xl:flex-col">
        <header className="border-b border-[var(--line)] px-4 py-5"><p className="section-label">Reviews</p><h1 className="mt-1.5 text-base font-semibold">Decision queue</h1><p className="mt-1.5 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Pinned revisions awaiting judgment.</p></header>
        <nav aria-label="Reviews" className="min-h-0 flex-1 overflow-auto">{reviews.map((item) => <Link key={item.id} href={`/reviews/${item.id}`} prefetch={false} onClick={() => { setReview(null); setLoading(true); }} className={`block border-b border-[var(--line)] px-4 py-3.5 transition-colors hover:bg-[var(--wash)] ${item.id === review.id ? "bg-[var(--paper-raised)] shadow-[inset_2px_0_var(--signal)]" : ""}`}><span className="block truncate text-xs font-semibold">{item.artifact.name}</span><span className="mt-1 block text-[0.625rem] text-[var(--muted-ink)]">Revision {item.revision.number} · {statusCopy[item.status]}</span><span className="mt-2 flex items-center justify-between text-[0.6rem] text-[var(--faint-ink)]"><span className="truncate">{item.assignments.map((assignment) => assignment.reviewer.displayName).join(", ")}</span><span>{relativeTime(item.createdAt)}</span></span>{item.unresolvedCommentCount ? <span className="mt-2 flex items-center gap-1 text-[0.6rem] font-semibold text-[var(--signal)]"><MessageCircle className="size-3" /> {item.unresolvedCommentCount} open</span> : null}</Link>)}</nav>
      </aside>

      <div className="grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-glass-88)] px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><Link href="/library" prefetch={false} aria-label="Back to library" className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-bold tracking-[-0.025em]">{review.artifact.name}</h2><span className={`hidden rounded-full px-2 py-1 text-[0.55rem] font-bold uppercase tracking-[0.09em] sm:inline ${statusTone}`}>{statusCopy[review.status]}</span></div><p className="mt-1 truncate text-[0.625rem] text-[var(--muted-ink)]">Revision {review.revision.number} · requested by {review.requestedBy.displayName}</p></div></div>
          <div className="flex items-center gap-1.5 sm:gap-2">{review.capabilities.canComment ? <Button variant="quiet" size="sm" className="max-sm:size-8 max-sm:p-0" onClick={() => setCommentOpen(true)}><MessageSquarePlus className="size-3.5" /><span className="sr-only sm:not-sr-only">Comment</span></Button> : null}{review.status === "OPEN" && review.capabilities.canDecide ? <><Button variant="outline" size="sm" className="max-sm:size-8 max-sm:p-0" onClick={() => setDecisionMode("changes")}><GitCommitHorizontal className="size-3.5" /><span className="sr-only sm:not-sr-only">Request changes</span></Button><Button variant="signal" size="sm" className="max-sm:size-8 max-sm:p-0" disabled={Boolean(review.capabilities.decisionBlockedReason)} title={review.capabilities.decisionBlockedReason ?? undefined} onClick={() => setDecisionMode("approve")}><Check className="size-3.5" /><span className="sr-only sm:not-sr-only">Approve</span></Button></> : null}</div>
        </header>

        <div className="grid min-h-0 min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative min-h-[430px] border-b border-[var(--line)] xl:min-h-0 xl:border-b-0 xl:border-r">
            {review.artifact.type === "DMN_DECISION"
              ? <DmnCanvas key={review.id} xml={review.revision.source} mode="view" onSelectionChange={(element) => setSelected(element)} />
              : <BpmnCanvas key={`${review.id}-${selected?.id ?? "none"}`} xml={review.revision.source} mode="view" highlightElementId={selected?.id} highlightElementIds={highlightedChangeIds} onSelectionChange={setSelected} />}
            <div className="absolute left-4 top-4 max-w-[calc(100%-2rem)] rounded-[var(--radius)] border border-[var(--line)] bg-[var(--raised-glass-92)] px-3 py-2 text-[0.625rem] font-semibold text-[var(--muted-ink)] shadow-sm backdrop-blur"><span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--signal)]" />{selected ? `${selected.name} · ${selected.id}` : "Select an element to anchor a comment"}</div>
            {review.changes.addedElements.length ? <div className="absolute bottom-4 left-4 rounded-full border border-[var(--line)] bg-[var(--raised-glass-92)] px-3 py-2 text-[0.6rem] font-semibold text-[var(--muted-ink)] shadow-sm backdrop-blur"><GitCompareArrows className="mr-1.5 inline size-3 text-[var(--signal)]" /> Dashed rings mark added elements</div> : null}
          </div>

          <aside className="min-h-0 bg-[var(--paper)] xl:overflow-auto">
            {review.publicationEligible ? (
              <section className={`border-b border-[var(--line)] px-5 py-5 ${review.publication ? "bg-[var(--ink)] text-[var(--paper)]" : "bg-[var(--moss-wash)]"}`}>
                <span className={`flex size-9 items-center justify-center rounded-[var(--radius)] ${review.publication ? "bg-white/10 text-[#d6e5d3]" : "bg-[var(--paper-raised)] text-[var(--moss)]"}`}>
                  {review.publication ? <PackageCheck className="size-5" /> : <ShieldCheck className="size-5" />}
                </span>
                <p className={`mt-4 text-[0.625rem] font-semibold ${review.publication ? "text-[#b8ccb5]" : "text-[var(--moss)]"}`}>
                  {review.publication ? `Publication · v${review.publication.artifactVersion}` : "Eligible for publication"}
                </p>
                <h3 className="mt-1.5 text-base font-semibold">
                  {review.publication ? "The approved source is sealed." : `Approval stays with revision ${review.revision.number}.`}
                </h3>
                <p className={`mt-3 text-xs leading-5 ${review.publication ? "text-white/55" : "text-[var(--muted-ink)]"}`}>
                  {review.publication
                    ? `${review.publication.manifestSha256.slice(0, 12)} · ${review.publication.deploymentCount} immutable deployment${review.publication.deploymentCount === 1 ? "" : "s"}`
                    : "New Studio edits create another draft; this approved source and decision remain unchanged."}
                </p>
                {review.capabilities.canPublish ? (
                  <Button variant="primary" size="sm" className="mt-5" onClick={() => { setActionError(null); setReleaseMode("publish"); }}>
                    <PackageCheck className="size-3.5" /> Create publication
                  </Button>
                ) : review.capabilities.canDeploy ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="signal" size="sm" onClick={() => void openDeployment()}><Rocket className="size-3.5" /> Deploy</Button>
                    {review.artifact.type === "BPMN_PROCESS" && review.publication?.deploymentCount ? <Button variant="outline" size="sm" className="border-white/20 text-[var(--paper)] hover:bg-white/10" onClick={() => void openStart()}><Play className="size-3.5" /> Start instance</Button> : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            <div className="sticky top-0 z-10 grid grid-cols-3 border-b border-[var(--line)] bg-[var(--paper-glass-94)] px-3 pt-2 backdrop-blur-xl">{(["brief", "comments", "activity"] as DetailTab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`border-b-2 px-2 py-3 text-[0.625rem] font-bold capitalize ${tab === item ? "border-[var(--signal)] text-[var(--ink)]" : "border-transparent text-[var(--faint-ink)]"}`}>{item}{item === "comments" && review.comments.length ? ` · ${review.comments.length}` : ""}</button>)}</div>

            {tab === "brief" ? <div className="divide-y divide-[var(--line)]">
              <section className="px-5 py-5"><p className="section-label">Decision brief</p><h3 className="mt-2 text-lg font-semibold tracking-[-0.025em]">Does this exact revision look right?</h3><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">{review.summary || "No extra brief was supplied. Inspect the process, validation, and element-level discussion before deciding."}</p></section>
              <section className="px-6 py-6"><div className="flex items-center justify-between"><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">What changed</p><GitCompareArrows className="size-3.5 text-[var(--signal)]" /></div>{review.changes.previousRevisionNumber === null ? <p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">This is the first saved revision of the artifact.</p> : <><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">Compared with revision {review.changes.previousRevisionNumber}: {review.changes.addedElements.length} added and {review.changes.removedElements.length} removed. Property and layout edits are included in the pinned source comparison.</p>{review.changes.addedElements.length || review.changes.removedElements.length ? <ul className="mt-4 space-y-2">{[...review.changes.addedElements.map((element) => ({ ...element, change: "Added" })), ...review.changes.removedElements.map((element) => ({ ...element, change: "Removed" }))].slice(0, 6).map((element) => <li key={`${element.change}-${element.id}`} className="flex items-center justify-between gap-3 text-[0.625rem]"><button type="button" onClick={() => element.change === "Added" && setSelected(element)} className="truncate font-semibold text-left">{element.name}</button><span className={element.change === "Added" ? "text-[var(--moss)]" : "text-[var(--signal)]"}>{element.change}</span></li>)}</ul> : null}</>}</section>
              <section className="px-6 py-6"><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Assigned judgment</p><div className="mt-4 space-y-3">{review.assignments.map((assignment) => <div key={assignment.id} className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-full bg-[var(--wash)] text-[var(--moss)]"><UserRoundCheck className="size-3.5" /></span><div><p className="text-xs font-bold">{assignment.reviewer.displayName}</p><p className="text-[0.625rem] text-[var(--muted-ink)]">Independent reviewer</p></div></div>)}</div></section>
              <section className="px-6 py-6"><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Publication checks</p><ul className="mt-4 space-y-3 text-xs"><li className="flex items-center justify-between"><span className="flex items-center gap-2"><Check className="size-3.5 text-[var(--moss)]" /> Immutable revision</span><span className="font-mono text-[0.6rem] text-[var(--faint-ink)]">{review.revision.contentSha256.slice(0, 10)}</span></li><li className="flex items-center justify-between"><span className="flex items-center gap-2">{review.revision.validation.status === "VALID" ? <Check className="size-3.5 text-[var(--moss)]" /> : <X className="size-3.5 text-[var(--danger)]" />} {review.artifact.type === "DMN_DECISION" ? "DMN profile" : "BPMN profile"}</span><span className="text-[var(--muted-ink)]">{review.revision.validation.status}</span></li><li className="flex items-center justify-between"><span className="flex items-center gap-2"><Check className="size-3.5 text-[var(--moss)]" /> Pinned dependencies</span><span className="text-[var(--muted-ink)]">{review.dependencies.length}</span></li><li className="flex items-center justify-between"><span className="flex items-center gap-2">{unresolvedComments.length ? <Circle className="size-3.5 text-[var(--gold)]" /> : <Check className="size-3.5 text-[var(--moss)]" />} Open comments</span><span className="text-[var(--muted-ink)]">{unresolvedComments.length}</span></li></ul>{review.dependencies.length ? <details className="group mt-5 border-t border-[var(--line)] pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-[0.6875rem] font-bold">Pinned dependency revisions <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><ul className="mt-3 space-y-2">{review.dependencies.map((dependency) => <li key={dependency.artifact.id} className="flex items-center justify-between gap-3 text-[0.625rem]"><span className="truncate font-semibold">{dependency.artifact.name} · r{dependency.revisionNumber}</span><span className="font-mono text-[var(--faint-ink)]">{dependency.contentSha256.slice(0, 8)}</span></li>)}</ul></details> : null}{review.capabilities.decisionBlockedReason && review.status === "OPEN" ? <p className="mt-5 rounded-xl bg-[var(--gold-wash)] px-3 py-3 text-[0.6875rem] leading-5 text-[var(--gold)]">{review.capabilities.decisionBlockedReason}</p> : null}</section>
              {review.capabilities.canCancel ? <section className="px-6 py-5"><button type="button" disabled={pending} onClick={() => void cancel()} className="text-[0.6875rem] font-bold text-[var(--danger)]">Cancel this review</button></section> : null}
            </div> : null}

            {tab === "comments" ? <div className="px-6 py-6">{review.comments.length ? <ol className="space-y-6">{review.comments.map((comment) => <li key={comment.id} className={`border-l-2 pl-4 ${comment.resolvedAt ? "border-[var(--line-strong)] opacity-55" : "border-[var(--signal)]"}`}><button type="button" onClick={() => setSelected({ id: comment.elementId, name: comment.elementName, type: "Element" })} className="font-mono text-[0.6rem] font-bold text-[var(--signal)]">{comment.elementName} · {comment.elementId}</button><p className="mt-2 text-xs leading-5">{comment.body}</p>{comment.mentions.length ? <p className="mt-2 flex flex-wrap gap-1.5">{comment.mentions.map((mention) => <span key={mention.id} className="rounded-full bg-[var(--signal-wash)] px-2 py-1 text-[0.55rem] font-bold text-[var(--signal)]">@{mention.displayName}</span>)}</p> : null}<div className="mt-3 flex items-center justify-between text-[0.6rem] text-[var(--faint-ink)]"><span>{comment.author.displayName} · {relativeTime(comment.createdAt)}</span>{comment.resolvedAt ? <span className="flex items-center gap-1 text-[var(--moss)]"><CheckCircle2 className="size-3" /> Resolved</span> : review.capabilities.canComment ? <button type="button" disabled={pending} onClick={() => void resolveComment(comment.id)} className="font-bold text-[var(--moss)]">Resolve</button> : null}</div></li>)}</ol> : <div className="py-16 text-center"><MessageCircle className="mx-auto size-5 text-[var(--faint-ink)]" /><p className="font-editorial mt-4 text-2xl text-[var(--faint-ink)]">No discussion yet.</p><p className="mt-2 text-[0.6875rem] text-[var(--muted-ink)]">Select an element and leave precise context.</p></div>}</div> : null}

            {tab === "activity" ? <div className="px-6 py-6"><ol className="space-y-0">{review.activity.map((entry, index) => <li key={entry.id} className="grid grid-cols-[1.5rem_1fr] gap-3"><div className="flex flex-col items-center"><span className="mt-1 flex size-5 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--paper-raised)]"><History className="size-2.5 text-[var(--faint-ink)]" /></span>{index < review.activity.length - 1 ? <span className="h-12 w-px bg-[var(--line)]" /> : null}</div><p className="pb-6 text-xs leading-5"><span className="font-bold">{entry.actor.displayName}</span> {activityCopy(entry.action)}<span className="mt-1 block text-[0.6rem] text-[var(--faint-ink)]">{relativeTime(entry.createdAt)}</span></p></li>)}</ol></div> : null}
            {actionError ? <p role="alert" className="m-5 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">{actionError}</p> : null}
          </aside>
        </div>
      </div>

      {commentOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-28)] px-4 pb-6 backdrop-blur-[2px] sm:items-center sm:pb-0" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) setCommentOpen(false); }}><form onSubmit={submitComment} role="dialog" aria-modal="true" aria-labelledby="comment-title" className="w-full max-w-lg rounded-[24px] border border-[var(--line)] bg-[var(--paper-raised)] p-6 shadow-[0_30px_100px_rgba(27,26,23,0.22)] sm:p-8"><div className="flex items-start justify-between"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Element context</p><h3 id="comment-title" className="font-editorial mt-2 text-3xl font-medium tracking-[-0.045em]">Comment on {selected?.name ?? "the selected element"}.</h3><p className="mt-2 font-mono text-[0.625rem] text-[var(--faint-ink)]">{selected?.id ?? "Select an element first"}</p></div><button type="button" onClick={() => setCommentOpen(false)} aria-label="Close comment" className="flex size-8 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button></div><label htmlFor="review-comment" className="sr-only">Review comment</label><textarea id="review-comment" autoFocus required minLength={1} maxLength={4000} rows={6} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="What should the author understand about this element?" className="mt-7 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm leading-6 outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" /><div className="mt-3 flex flex-wrap items-center gap-2"><span className="flex items-center gap-1 text-[0.6rem] font-bold text-[var(--faint-ink)]"><AtSign className="size-3" /> Mention</span>{reviewParticipants.map((person) => { const active = mentionedPrincipalIds.includes(person.id); return <button key={person.id} type="button" onClick={() => { setMentionedPrincipalIds((current) => active ? current.filter((id) => id !== person.id) : [...current, person.id]); if (!active && !commentBody.includes(`@${person.displayName}`)) setCommentBody((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${person.displayName} `); }} className={`rounded-full px-2.5 py-1 text-[0.58rem] font-bold ${active ? "bg-[var(--signal-wash)] text-[var(--signal)]" : "bg-[var(--wash)] text-[var(--muted-ink)]"}`}>{person.displayName}</button>; })}</div>{actionError ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{actionError}</p> : null}<div className="mt-6 flex justify-between"><Button type="button" variant="quiet" onClick={() => setCommentOpen(false)}>Cancel</Button><Button type="submit" variant="signal" disabled={pending || !selected || !commentBody.trim()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />} Add anchored comment</Button></div></form></div> : null}

      {decisionMode ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-28)] px-4 pb-6 backdrop-blur-[2px] sm:items-center sm:pb-0" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="decision-title" className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-[24px] border border-[var(--line)] bg-[var(--paper-raised)] p-6 shadow-[0_30px_100px_rgba(27,26,23,0.22)] sm:p-8"><span className={`flex size-12 items-center justify-center rounded-full ${decisionMode === "approve" ? "bg-[var(--moss-wash)] text-[var(--moss)]" : "bg-[var(--signal-wash)] text-[var(--signal)]"}`}>{decisionMode === "approve" ? <ShieldCheck className="size-5" /> : <MessageCircle className="size-5" />}</span><p className="mt-6 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--faint-ink)]">Recorded decision</p><h3 id="decision-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.05em]">{decisionMode === "approve" ? `Approve revision ${review.revision.number}?` : "What must change?"}</h3><p className="mt-4 text-xs leading-5 text-[var(--muted-ink)]">{decisionMode === "approve" ? "Your identity and this exact source hash will remain attached to the approval." : "This closes the review without altering its pinned revision."}</p>{decisionMode === "approve" ? <div className="mt-6 border-y border-[var(--line)] py-4"><p className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Approval summary</p><ul className="mt-3 space-y-2 text-xs"><li className="flex items-center justify-between"><span>Validation profile</span><strong className="text-[var(--moss)]">{review.revision.validation.status}</strong></li><li className="flex items-center justify-between"><span>Open discussion</span><strong className={unresolvedComments.length ? "text-[var(--gold)]" : "text-[var(--moss)]"}>{unresolvedComments.length}</strong></li><li className="flex items-center justify-between"><span>Changes from r{review.changes.previousRevisionNumber ?? "—"}</span><strong>{review.changes.addedElements.length} added · {review.changes.removedElements.length} removed</strong></li><li className="flex items-center justify-between"><span>Pinned dependencies</span><strong>{review.dependencies.length}</strong></li></ul></div> : null}<label htmlFor="decision-note" className="mt-7 block text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Decision note {decisionMode === "changes" ? "· required" : "· optional"}</label><textarea id="decision-note" required={decisionMode === "changes"} rows={4} maxLength={4000} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder={decisionMode === "approve" ? "Optional context for the publication record" : "Describe the required change clearly"} className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm leading-6 outline-none focus:border-[var(--signal)]" />{actionError ? <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{actionError}</p> : null}<div className="mt-6 flex justify-between"><Button variant="quiet" disabled={pending} onClick={() => { setDecisionMode(null); setActionError(null); }}>Cancel</Button><Button variant={decisionMode === "approve" ? "primary" : "signal"} disabled={pending || (decisionMode === "changes" && !decisionNote.trim())} onClick={() => void decide()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : decisionMode === "approve" ? <Check className="size-3.5" /> : <GitCommitHorizontal className="size-3.5" />}{decisionMode === "approve" ? "Record approval" : "Request changes"}</Button></div></section></div> : null}

      {releaseMode === "publish" ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-32)] px-4 pb-6 backdrop-blur-[3px] sm:items-center sm:pb-0" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="publish-title" className="w-full max-w-lg overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_34px_110px_rgba(27,26,23,0.25)]">
            <div className="bg-[var(--moss-wash)] p-7 sm:p-9">
              <div className="mb-7 flex items-center gap-2 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--moss)]"><span className="flex size-5 items-center justify-center rounded-full bg-[var(--moss)] text-white"><Check className="size-3" /></span> Review <span className="h-px flex-1 bg-[var(--line-strong)]" /><span className="flex size-5 items-center justify-center rounded-full border border-[var(--moss)]">2</span> Publish <span className="h-px flex-1 bg-[var(--line-strong)]" /><span className="flex size-5 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--faint-ink)]">3</span> Place</div>
              <span className="flex size-12 items-center justify-center rounded-full bg-[var(--paper-raised)] text-[var(--moss)]"><PackageCheck className="size-5" /></span>
              <p className="mt-7 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Version boundary</p>
              <h3 id="publish-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Seal revision {review.revision.number} for release?</h3>
              <p className="mt-4 text-xs leading-6 text-[var(--muted-ink)]">Wanaflow will create the next artifact version from the exact approved source. The publication, approval snapshot, and manifest cannot be edited later.</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 border-y border-[var(--line)] px-7 py-6 font-mono text-[0.625rem] sm:px-9">
              <dt className="text-[var(--faint-ink)]">Revision</dt><dd className="truncate text-right">{review.revision.id}</dd>
              <dt className="text-[var(--faint-ink)]">Source SHA</dt><dd className="truncate text-right">{review.revision.contentSha256}</dd>
              <dt className="text-[var(--faint-ink)]">Approval</dt><dd className="truncate text-right">{review.decision?.id}</dd>
            </dl>
            {actionError ? <p role="alert" className="mx-7 mt-5 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs text-[var(--danger)] sm:mx-9">{actionError}</p> : null}
            <div className="flex items-center justify-between p-6 sm:px-9">
              <Button variant="quiet" disabled={pending} onClick={() => { setReleaseMode(null); setActionError(null); }}>Not yet</Button>
              <Button variant="primary" disabled={pending} onClick={() => void publish()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />} Create immutable publication</Button>
            </div>
          </section>
        </div>
      ) : null}

      {releaseMode === "deploy" ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-32)] backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) setReleaseMode(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="deploy-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-32px_0_100px_rgba(27,26,23,0.2)]">
            <header className="border-b border-[var(--line)] px-6 py-7 sm:px-8">
              <div className="mb-6 flex items-center gap-2 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--moss)]"><span className="flex size-5 items-center justify-center rounded-full bg-[var(--moss)] text-white"><Check className="size-3" /></span> Review <span className="h-px flex-1 bg-[var(--moss)]" /><span className="flex size-5 items-center justify-center rounded-full bg-[var(--moss)] text-white"><Check className="size-3" /></span> Publish <span className="h-px flex-1 bg-[var(--line-strong)]" /><span className="flex size-5 items-center justify-center rounded-full border border-[var(--signal)] text-[var(--signal)]">3</span> Place</div>
              <div className="flex items-start justify-between gap-5">
                <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Environment binding</p><h3 id="deploy-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Place publication v{review.publication?.artifactVersion}.</h3><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">This creates a new immutable deployment record. Existing deployments stay intact.</p></div>
                <button type="button" disabled={pending} onClick={() => setReleaseMode(null)} aria-label="Close deployment" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-7 sm:px-8">
              <fieldset>
                <legend className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Target environment</legend>
                <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                  {environments.map((environment) => (
                    <label key={environment.id} className="flex cursor-pointer items-center gap-4 py-4">
                      <input type="radio" name="environment" value={environment.id} checked={selectedEnvironmentId === environment.id} onChange={() => setSelectedEnvironmentId(environment.id)} className="size-4 accent-[var(--signal)]" />
                      <span className="flex size-9 items-center justify-center rounded-full bg-[var(--wash)] text-[var(--muted-ink)]"><Server className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block text-xs font-bold">{environment.name}</span><span className="mt-1 block text-[0.625rem] text-[var(--muted-ink)]">{environment.deploymentCount ? `${environment.deploymentCount} deployment${environment.deploymentCount === 1 ? "" : "s"} · latest #${environment.latestDeployment?.sequence}` : "No deployments yet"}</span></span>
                      <span className="font-mono text-[0.6rem] text-[var(--faint-ink)]">{environment.key}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-8"><label htmlFor="deployment-note" className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Release note <span className="normal-case tracking-normal">· optional</span></label><textarea id="deployment-note" rows={5} maxLength={2000} value={deploymentNote} onChange={(event) => setDeploymentNote(event.target.value)} placeholder="Why is this publication being placed here?" className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm leading-6 outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" /></div>
              <div className="mt-8 rounded-2xl bg-[var(--wash)] px-4 py-4"><p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Resolved bundle</p><p className="mt-2 font-mono text-[0.625rem] leading-5 text-[var(--muted-ink)]">manifest {review.publication?.manifestSha256.slice(0, 16)} · wanaflow-bpmn-v1</p></div>
              {actionError ? <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs text-[var(--danger)]">{actionError}</p> : null}
            </div>
            <footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><Button variant="quiet" disabled={pending} onClick={() => setReleaseMode(null)}>Cancel</Button><Button variant="signal" disabled={pending || !selectedEnvironmentId} onClick={() => void deploy()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Create deployment</Button></footer>
          </section>
        </div>
      ) : null}

      {review.artifact.type === "BPMN_PROCESS" && releaseMode === "start" && startDeployment ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-34)] px-4 pb-6 backdrop-blur-[3px] sm:items-center sm:pb-0" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="start-title" className="w-full max-w-xl overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_34px_110px_rgba(27,26,23,0.25)]">
            <div className="bg-[var(--signal-wash)] px-7 py-7 sm:px-9 sm:py-8">
              <span className="flex size-12 items-center justify-center rounded-full bg-[var(--paper-raised)] text-[var(--signal)]"><Play className="size-5 fill-current" /></span>
              <p className="mt-6 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Immutable deployment · {startDeployment.environmentKey}</p>
              <h3 id="start-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Start the first durable instance.</h3>
              <p className="mt-4 text-xs leading-5 text-[var(--muted-ink)]">Wanaflow will accept one start command against deployment #{startDeployment.sequence}. A separate worker creates the first visible checkpoint.</p>
            </div>
            <div className="space-y-6 px-7 py-7 sm:px-9">
              <label className="block"><span className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Business key <span className="normal-case tracking-normal">· optional</span></span><input value={businessKey} onChange={(event) => setBusinessKey(event.target.value)} maxLength={255} placeholder="expense:2026:0042" className="mt-3 h-11 w-full rounded-xl border border-[var(--line-strong)] bg-transparent px-4 font-mono text-xs outline-none placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" /></label>
              <label className="block"><span className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Variables <span className="normal-case tracking-normal">· JSON object</span></span><textarea value={startVariables} onChange={(event) => setStartVariables(event.target.value)} rows={6} spellCheck={false} className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-[var(--ink)] p-4 font-mono text-[0.6875rem] leading-5 text-[#e7e3da] outline-none focus:border-[var(--signal)]" /></label>
              <details className="group"><summary className="flex cursor-pointer list-none items-center gap-2 text-[0.6875rem] font-semibold text-[var(--muted-ink)]">Deployment detail <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-l border-[var(--line-strong)] pl-4 font-mono text-[0.6rem] text-[var(--muted-ink)]"><dt>ID</dt><dd className="truncate text-right">{startDeployment.id}</dd><dt>Bundle</dt><dd className="truncate text-right">{startDeployment.bundleSha256}</dd></dl></details>
              {actionError ? <p role="alert" className="rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs text-[var(--danger)]">{actionError}</p> : null}
            </div>
            <footer className="flex items-center justify-between border-t border-[var(--line)] px-7 py-5 sm:px-9"><Button variant="quiet" disabled={pending} onClick={() => { setReleaseMode(null); setActionError(null); }}>Later</Button><Button variant="signal" disabled={pending} onClick={() => void start()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />} Accept start command</Button></footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
