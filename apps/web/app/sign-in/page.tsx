"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, LoaderCircle, Workflow } from "lucide-react";

import { authClient } from "@/lib/auth-client";

function safeDestination(value: string | null) {
  if (!value?.startsWith("/")) return "/";
  try {
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await authClient.signIn.email({ email, password, rememberMe: false });
    if (result.error) {
      setPending(false);
      setError("Those credentials were not recognized.");
      return;
    }

    router.replace(safeDestination(searchParams.get("next")));
    router.refresh();
  };

  return (
    <main className="auth-page relative grid min-h-screen overflow-hidden bg-[var(--paper)] lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.7fr)]">
      <div className="app-grain" aria-hidden="true" />
      <section className="relative hidden min-h-screen overflow-hidden border-r border-[var(--line)] px-14 py-12 lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="flex items-center gap-3 text-sm font-bold tracking-[-0.04em]">
          <span className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--ink)] text-[var(--paper)]">wa</span>
          Wanaflow
        </div>
        <div className="relative z-10 max-w-[680px] pb-12">
          <p className="mb-5 text-[0.6875rem] font-bold uppercase tracking-[0.19em] text-[var(--moss)]">Model · decide · run</p>
          <h1 className="font-editorial text-[clamp(4.3rem,7.2vw,7.8rem)] font-[460] leading-[0.82] tracking-[-0.065em]">
            Workflows,
            <br />with judgment.
          </h1>
          <p className="mt-8 max-w-md text-sm leading-7 text-[var(--muted-ink)]">
            A quiet place for teams to shape processes, make decisions, and keep execution understandable.
          </p>
        </div>
        <div className="absolute -bottom-32 -right-36 size-[560px] rounded-full border border-[var(--line)]" aria-hidden="true">
          <div className="absolute left-20 top-20 size-[400px] rounded-full border border-[var(--line)]" />
          <div className="absolute left-40 top-40 size-[240px] rounded-full bg-[var(--signal-wash)]" />
        </div>
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Open process infrastructure</p>
      </section>

      <section className="relative flex min-h-screen items-center justify-center px-6 py-14 sm:px-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-12 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--ink)] text-sm font-bold text-[var(--paper)]">wa</span>
            <span className="text-sm font-bold">Wanaflow</span>
          </div>
          <span className="mb-8 flex size-11 items-center justify-center rounded-full bg-[var(--signal-wash)] text-[var(--signal)]">
            <Workflow className="size-5 stroke-[1.6]" />
          </span>
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--faint-ink)]">Your workspace</p>
          <h2 className="font-editorial mt-3 text-5xl font-medium tracking-[-0.055em]">Welcome back.</h2>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">Sign in with the account created by your Wanaflow administrator.</p>

          <form onSubmit={submit} className="mt-10 space-y-6">
            <div>
              <label htmlFor="email" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 text-sm font-semibold outline-none transition-colors placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" placeholder="you@company.com" />
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 text-sm font-semibold outline-none transition-colors placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)]" placeholder="Your password" />
            </div>
            {error ? <p role="alert" className="flex items-center gap-2 text-xs font-semibold text-[var(--danger)]"><KeyRound className="size-3.5" /> {error}</p> : null}
            <button type="submit" disabled={pending} className="group flex h-12 w-full items-center justify-between rounded-[var(--radius)] bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60">
              <span>{pending ? "Opening workspace…" : "Enter Wanaflow"}</span>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
            </button>
          </form>
          <p className="mt-8 text-[0.6875rem] leading-5 text-[var(--faint-ink)]">Public registration is closed. Ask an organization owner if you need access.</p>
        </div>
      </section>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[var(--paper)]" />}>
      <SignInForm />
    </Suspense>
  );
}
