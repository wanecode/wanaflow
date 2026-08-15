"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact, ReviewerCandidate } from "@wanaflow/db";
import { Button } from "@wanaflow/ui";
import { ArrowLeft, Check, ChevronDown, GitPullRequestArrow, Laptop, LoaderCircle, Save, Scale, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DmnCanvas, type DmnCanvasHandle } from "./dmn-canvas";
import { CollaborationPresence } from "./collaboration-presence";
import { useArtifactPresence } from "@/lib/use-artifact-presence";
import {
  loadArtifact,
  loadReviewerCandidates,
  requestArtifactReview,
  saveArtifact,
  WanaflowApiError,
} from "@/lib/api-client";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

export function DmnStudioWorkspace({ artifactId }: { artifactId: string }) {
  const router = useRouter();
  const canvasRef = useRef<DmnCanvasHandle>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [candidates, setCandidates] = useState<ReviewerCandidate[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [pendingReview, setPendingReview] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string; type: string } | null>(null);
  const { collaborators, connection } = useArtifactPresence({
    artifactId: artifact?.id ?? null,
    revisionId: artifact?.revision.id ?? null,
    selectedElement: selected,
  });

  useEffect(() => {
    let active = true;
    loadArtifact(artifactId).then((loaded) => {
      if (!active) return;
      if (loaded.type !== "DMN_DECISION") throw new Error("This artifact is not a DMN decision.");
      setArtifact(loaded);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "The decision could not be opened.");
    });
    return () => { active = false; };
  }, [artifactId]);

  const dirty = useCallback(() => setSaveState((state) => state === "saving" ? state : "dirty"), []);
  const save = useCallback(async () => {
    if (!artifact || !canvasRef.current || saveState === "saving") return null;
    setSaveState("saving");
    setError(null);
    try {
      const saved = await saveArtifact(artifact.id, artifact.revision.id, await canvasRef.current.saveXml());
      setArtifact(saved);
      setSaveState("saved");
      return saved;
    } catch (caught) {
      setSaveState(caught instanceof WanaflowApiError && caught.code === "REVISION_CONFLICT" ? "conflict" : "error");
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.");
      return null;
    }
  }, [artifact, saveState]);

  useEffect(() => {
    if (saveState !== "dirty" || connection === "offline" || connection === "retrying") return;
    const timeout = window.setTimeout(() => void save(), 1_400);
    return () => window.clearTimeout(timeout);
  }, [connection, save, saveState]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [save]);

  const openReview = async () => {
    if (!artifact) return;
    setError(null);
    try {
      const loaded = await loadReviewerCandidates(artifact.id);
      setCandidates(loaded);
      setReviewerIds(loaded.find((entry) => entry.eligible)?.id ? [loaded.find((entry) => entry.eligible)!.id] : []);
      setReviewOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reviewers could not be loaded.");
    }
  };

  const requestReview = async () => {
    if (!artifact || !reviewerIds.length) return;
    setPendingReview(true);
    setError(null);
    try {
      const review = await requestArtifactReview(artifact.id, {
        revisionId: artifact.revision.id,
        reviewerIds,
        summary,
      });
      router.push(`/reviews/${review.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be requested.");
    } finally {
      setPendingReview(false);
    }
  };

  if (error && !artifact) return <div className="workspace-page flex min-h-[640px] items-center justify-center px-6 text-center"><div><p className="font-editorial text-4xl">This decision stayed closed.</p><p className="mt-3 text-sm text-[var(--muted-ink)]">{error}</p><Link href="/library" className="mt-6 inline-flex text-xs font-bold text-[var(--signal)]">Return to Library</Link></div></div>;
  if (!artifact) return <div className="workspace-page flex min-h-[640px] items-center justify-center text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin text-[var(--signal)]" /> Opening the decision</div>;

  const validation = artifact.revision.validation;
  const decision = validation.profile === "wanaflow-dmn-table@1" ? validation.decision : null;

  return (
    <div className="workspace-page grid h-full min-h-[640px] grid-rows-[52px_minmax(0,1fr)_30px] overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><Link href="/library" className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]" aria-label="Back to library"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><h1 className="truncate text-sm font-semibold tracking-[-0.025em]">{artifact.name}</h1><p className="text-[0.625rem] font-semibold text-[var(--muted-ink)]">DMN · Draft revision {artifact.revision.number}</p></div></div>
        <div className="flex items-center gap-3"><CollaborationPresence collaborators={collaborators} connection={connection} /><span className={`hidden items-center gap-1.5 text-[0.625rem] font-semibold sm:flex ${saveState === "error" || saveState === "conflict" ? "text-[var(--danger)]" : saveState === "dirty" ? "text-[var(--gold)]" : "text-[var(--moss)]"}`}>{saveState === "saving" ? <LoaderCircle className="size-3 animate-spin" /> : saveState === "saved" ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}{saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "dirty" ? "Autosaving…" : saveState === "conflict" ? "Newer revision available" : "Save failed"}</span>{saveState !== "saved" ? <Button variant="primary" size="sm" onClick={() => void save()} disabled={saveState === "saving"}><Save className="size-3.5" /> Save</Button> : <Button variant="quiet" size="sm" onClick={() => void openReview()}><GitPullRequestArrow className="size-3.5" /> Request review</Button>}</div>
      </header>
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_256px]">
        <div className="hidden min-h-0 lg:block"><DmnCanvas key={artifact.revision.id} ref={canvasRef} xml={artifact.revision.source} onDirtyChange={dirty} onSelectionChange={setSelected} /></div>
        <div className="flex min-h-0 items-center justify-center px-8 text-center lg:hidden"><div className="max-w-sm"><span className="mx-auto flex size-11 items-center justify-center rounded-[var(--radius)] bg-[var(--signal-wash)] text-[var(--signal)]"><Laptop className="size-5" /></span><h2 className="mt-5 text-xl font-semibold">Continue on a larger screen.</h2><p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">Inputs, outputs, and rule cells need room to stay legible together.</p></div></div>
        <aside className="hidden overflow-auto border-l border-[var(--line)] bg-[var(--paper)] px-5 py-6 lg:block">
          <p className="section-label">Decision guide</p><h2 className="mt-2 text-base font-semibold">Make the rule readable first.</h2><p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Keep inputs, outputs, and the result explicit.</p>
          <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)] text-[0.6875rem]"><div className="flex items-center justify-between py-3"><dt className="text-[var(--muted-ink)]">Hit policy</dt><dd className="font-mono text-[0.625rem]">{decision?.hitPolicy ?? "—"}</dd></div><div className="flex items-center justify-between py-3"><dt className="text-[var(--muted-ink)]">Inputs · outputs</dt><dd className="font-semibold">{decision ? `${decision.inputs.length} · ${decision.outputs.length}` : "—"}</dd></div><div className="flex items-center justify-between py-3"><dt className="text-[var(--muted-ink)]">Rules</dt><dd className="font-semibold">{decision?.rules.length ?? "—"}</dd></div></dl>
          <details className="group mt-5"><summary className="flex cursor-pointer list-none items-center justify-between text-[0.6875rem] font-semibold">Execution profile <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><p className="mt-3 border-l border-[var(--line-strong)] pl-3 text-[0.625rem] leading-5 text-[var(--muted-ink)]">UNIQUE or FIRST · string, number, boolean · no time-dependent FEEL functions.</p></details>
          <div className="mt-6 flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--moss-wash)] text-[var(--moss)]"><ShieldCheck className="size-3.5" /></span><div><p className="text-[0.6875rem] font-semibold">Pinned revision</p><p className="mt-1 text-[0.625rem] leading-5 text-[var(--muted-ink)]">A Business Rule Task binds <code>{artifact.key}</code>.</p></div></div>
          {error ? <p className="mt-6 text-xs leading-5 text-[var(--danger)]">{error}</p> : null}
        </aside>
      </div>
      <footer className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper)] px-4 text-[0.625rem] font-semibold text-[var(--muted-ink)] sm:px-6"><span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${validation.status === "VALID" ? "bg-[var(--moss)]" : "bg-[var(--gold)]"}`} /> {validation.status === "VALID" ? "Deterministic profile valid" : `${validation.issues.length} decision issues`}</span><span className="flex items-center gap-1.5"><Scale className="size-3" /> {artifact.key}</span></footer>

      {reviewOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay-30)] px-4 pb-6 backdrop-blur-[3px] sm:items-center sm:pb-0" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="dmn-review-title" className="w-full max-w-lg rounded-[26px] border border-[var(--line)] bg-[var(--paper-raised)] p-7 shadow-[0_34px_110px_rgba(27,26,23,0.24)] sm:p-9"><div className="flex items-start justify-between gap-5"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Independent review</p><h3 id="dmn-review-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Pin revision {artifact.revision.number}.</h3></div><button type="button" aria-label="Close" onClick={() => setReviewOpen(false)} className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--wash)]"><X className="size-4" /></button></div><p className="mt-4 text-xs leading-5 text-[var(--muted-ink)]">The reviewer sees this exact table and source hash. Later draft edits cannot change the review.</p><fieldset className="mt-7"><legend className="text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Reviewer</legend><div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{candidates.map((candidate) => <label key={candidate.id} className={`flex items-center gap-3 py-3 ${candidate.eligible ? "cursor-pointer" : "opacity-45"}`}><input type="checkbox" disabled={!candidate.eligible} checked={reviewerIds.includes(candidate.id)} onChange={(event) => setReviewerIds((ids) => event.target.checked ? [...ids, candidate.id] : ids.filter((id) => id !== candidate.id))} className="size-4 accent-[var(--signal)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{candidate.displayName}</span><span className="text-[0.625rem] text-[var(--faint-ink)]">{candidate.role.replaceAll("-", " ")}</span></span></label>)}</div></fieldset><label className="mt-6 block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Context · optional<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} rows={4} className="mt-3 w-full resize-none rounded-2xl border border-[var(--line-strong)] bg-transparent p-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[var(--signal)]" /></label>{error ? <p className="mt-4 text-xs text-[var(--danger)]">{error}</p> : null}<div className="mt-7 flex items-center justify-between"><Button variant="quiet" onClick={() => setReviewOpen(false)}>Not yet</Button><Button variant="signal" disabled={pendingReview || !reviewerIds.length} onClick={() => void requestReview()}>{pendingReview ? <LoaderCircle className="size-3.5 animate-spin" /> : <GitPullRequestArrow className="size-3.5" />} Request review</Button></div></section></div> : null}
    </div>
  );
}
