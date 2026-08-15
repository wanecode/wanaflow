"use client";

import Link from "next/link";
import { ArrowRight, GitPullRequestArrow, MousePointer2, Save, X } from "lucide-react";

export const onboardingStorageKey = "wanaflow:onboarding:complete";

export function FirstRunGuide({ sampleArtifactId, onDismiss }: { sampleArtifactId: string; onDismiss: () => void }) {
  const dismiss = () => {
    window.localStorage.setItem(onboardingStorageKey, "1");
    onDismiss();
  };

  return (
    <section className="relative border-b border-[var(--line)] py-6" aria-labelledby="first-run-title">
      <span className="absolute inset-y-6 left-0 w-0.5 bg-[var(--signal)]" aria-hidden="true" />
      <button type="button" onClick={dismiss} aria-label="Dismiss getting started" className="absolute right-0 top-5 flex size-8 items-center justify-center rounded-[var(--radius)] text-[var(--faint-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"><X className="size-3.5" /></button>
      <div className="grid gap-6 pl-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.45fr)_auto] lg:items-center">
        <div>
          <p className="page-kicker text-[var(--signal)]">Start with something real</p>
          <h2 id="first-run-title" className="mt-1.5 text-base font-semibold">Explore employee onboarding.</h2>
          <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">A safe sample process is already waiting. Nothing runs until your team approves and publishes it.</p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          <li className="flex gap-2.5"><MousePointer2 className="mt-0.5 size-3.5 shrink-0 text-[var(--signal)]" /><span><strong className="block text-xs">Look around</strong><span className="mt-1 block text-[0.625rem] leading-4 text-[var(--muted-ink)]">Select any process step.</span></span></li>
          <li className="flex gap-2.5"><Save className="mt-0.5 size-3.5 shrink-0 text-[var(--moss)]" /><span><strong className="block text-xs">Make it yours</strong><span className="mt-1 block text-[0.625rem] leading-4 text-[var(--muted-ink)]">Autosave keeps a recovery copy.</span></span></li>
          <li className="flex gap-2.5"><GitPullRequestArrow className="mt-0.5 size-3.5 shrink-0 text-[var(--gold)]" /><span><strong className="block text-xs">Invite judgment</strong><span className="mt-1 block text-[0.625rem] leading-4 text-[var(--muted-ink)]">Pin a revision for review.</span></span></li>
        </ol>
        <Link href={`/studio/${sampleArtifactId}?tour=1`} prefetch={false} className="inline-flex h-9 items-center gap-2 self-start rounded-[var(--radius)] bg-[var(--ink)] px-3 text-xs font-semibold text-[var(--paper)] lg:self-auto">Open guided sample <ArrowRight className="size-3.5" /></Link>
      </div>
    </section>
  );
}
