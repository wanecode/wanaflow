"use client";

import { useState } from "react";
import type { Review } from "@wanaflow/db";
import { Check, ChevronDown, FileLock2, GitPullRequestArrow, PackageCheck, PencilLine } from "lucide-react";

const steps = [
  { label: "Design", detail: "Shape a shared draft", icon: PencilLine },
  { label: "Review", detail: "Pin an exact revision", icon: GitPullRequestArrow },
  { label: "Approve", detail: "Record independent judgment", icon: FileLock2 },
  { label: "Publish", detail: "Seal an immutable release", icon: PackageCheck },
] as const;

function journeyState(review: Review | null) {
  if (review?.publication) return { index: 3, label: "Published" };
  if (review?.status === "APPROVED") return { index: 2, label: "Approved" };
  if (review?.status === "OPEN") return { index: 1, label: "In review" };
  if (review?.status === "CHANGES_REQUESTED") return { index: 0, label: "Changes requested" };
  return { index: 0, label: "Draft" };
}

export function StudioJourney({ review }: { review: Review | null }) {
  const [open, setOpen] = useState(false);
  const state = journeyState(review);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label="Open draft journey" className="flex items-center gap-1 rounded-[var(--radius)] bg-[var(--wash)] px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted-ink)] hover:text-[var(--ink)]">
        {state.label}<ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <section className="absolute left-0 top-8 z-40 w-72 rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--paper-raised)] p-4 shadow-lg" aria-label="Draft journey">
          <p className="section-label">From idea to release</p>
          <ol className="mt-3">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const complete = index < state.index || (index === 3 && Boolean(review?.publication));
              const active = index === state.index;
              return (
                <li key={step.label} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0">
                  <span className={`relative flex size-7 items-center justify-center rounded-full ${complete ? "bg-[var(--moss)] text-white" : active ? "bg-[var(--signal)] text-white" : "bg-[var(--wash)] text-[var(--faint-ink)]"}`}>
                    {complete ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                    {index < steps.length - 1 ? <span className="absolute left-1/2 top-7 h-3 w-px -translate-x-1/2 bg-[var(--line-strong)]" /> : null}
                  </span>
                  <span className="pt-0.5"><strong className={`block text-xs ${active ? "text-[var(--ink)]" : "text-[var(--muted-ink)]"}`}>{step.label}</strong><span className="mt-0.5 block text-[0.6rem] text-[var(--faint-ink)]">{step.detail}</span></span>
                </li>
              );
            })}
          </ol>
          {review?.status === "CHANGES_REQUESTED" ? <p className="mt-4 border-t border-[var(--line)] pt-3 text-[0.625rem] leading-5 text-[var(--gold)]">The reviewer asked for another draft. The previous judgment remains in history.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
