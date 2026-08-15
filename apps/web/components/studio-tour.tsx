"use client";

import { useState } from "react";
import { GitPullRequestArrow, MousePointer2, Save, X } from "lucide-react";
import { Button } from "@wanaflow/ui";

import { onboardingStorageKey } from "./first-run-guide";

const steps = [
  { icon: MousePointer2, eyebrow: "1 of 3 · Explore", title: "Select a process step.", body: "The canvas stays spacious. Details appear in the inspector only when you choose something." },
  { icon: Save, eyebrow: "2 of 3 · Shape", title: "Try one small change.", body: "Studio saves after a short pause and keeps a local recovery copy if the connection drops." },
  { icon: GitPullRequestArrow, eyebrow: "3 of 3 · Decide", title: "Invite an independent reviewer.", body: "Review pins the exact revision. Later draft work cannot silently change what was approved." },
] as const;

export function StudioTour() {
  const [step, setStep] = useState<number | null>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tour") === "1" ? 0 : null);

  if (step === null) return null;
  const current = steps[step];
  const Icon = current.icon;
  const finish = () => {
    window.localStorage.setItem(onboardingStorageKey, "1");
    window.history.replaceState(null, "", window.location.pathname);
    setStep(null);
  };

  return (
    <section className="absolute bottom-5 left-5 z-30 w-[min(330px,calc(100%-2.5rem))] rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--raised-glass-97)] p-5 shadow-xl backdrop-blur-xl" aria-label="Studio getting started">
      <div className="flex items-start justify-between gap-4"><span className="flex size-9 items-center justify-center rounded-[var(--radius)] bg-[var(--signal-wash)] text-[var(--signal)]"><Icon className="size-4" /></span><button type="button" onClick={finish} aria-label="Close guided tour" className="flex size-7 items-center justify-center rounded-[var(--radius)] text-[var(--faint-ink)] hover:bg-[var(--wash)]"><X className="size-3.5" /></button></div>
      <p className="mt-4 page-kicker">{current.eyebrow}</p>
      <h2 className="mt-1.5 text-base font-semibold">{current.title}</h2>
      <p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">{current.body}</p>
      <div className="mt-5 flex items-center justify-between"><div className="flex gap-1">{steps.map((_, index) => <span key={index} className={`h-1 w-5 rounded-full ${index <= step ? "bg-[var(--signal)]" : "bg-[var(--line-strong)]"}`} />)}</div><Button variant={step === steps.length - 1 ? "primary" : "outline"} size="sm" onClick={() => step === steps.length - 1 ? finish() : setStep(step + 1)}>{step === steps.length - 1 ? "Start shaping" : "Next"}</Button></div>
    </section>
  );
}
