"use client";

import { useEffect, useState } from "react";
import type { InvitationPreview } from "@wanaflow/db";
import { ArrowRight, Check, LoaderCircle, UsersRound } from "lucide-react";
import Link from "next/link";

import { acceptWorkspaceInvitation, loadInvitation } from "@/lib/api-client";

export function JoinWorkspace({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadInvitation(token).then((value) => { if (active) setInvitation(value); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "This invitation could not be opened."); });
    return () => { active = false; };
  }, [token]);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      await acceptWorkspaceInvitation(token, password);
      setAccepted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be accepted.");
    } finally {
      setPending(false);
    }
  };

  return <main className="auth-page relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--paper)] px-6 py-14"><div className="app-grain" aria-hidden="true" /><section className="relative z-10 w-full max-w-[560px] border-y border-[var(--line-strong)] py-10 sm:py-14"><div className="flex items-center gap-3 text-sm font-bold"><span className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--ink)] text-[var(--paper)]">wa</span> Wanaflow</div>{!invitation && !error ? <p className="mt-16 flex items-center text-sm text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin" /> Opening your invitation</p> : accepted ? <div className="mt-16"><span className="flex size-12 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><Check className="size-5" /></span><p className="mt-8 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">You are in</p><h1 className="font-editorial mt-3 text-6xl font-medium leading-[0.9] tracking-[-0.06em]">Your workspace is waiting.</h1><p className="mt-6 max-w-md text-sm leading-6 text-[var(--muted-ink)]">Sign in as {invitation?.email} to enter {invitation?.workspace.name}.</p><Link href="/sign-in?joined=1" className="mt-8 inline-flex h-11 items-center gap-3 rounded-[var(--radius)] bg-[var(--ink)] px-5 text-xs font-bold text-[var(--paper)]">Continue to sign in <ArrowRight className="size-3.5" /></Link></div> : invitation ? <div className="mt-16"><span className="flex size-12 items-center justify-center rounded-full bg-[var(--signal-wash)] text-[var(--signal)]"><UsersRound className="size-5" /></span><p className="mt-8 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">{invitation.organization.name} invited you</p><h1 className="font-editorial mt-3 text-6xl font-medium leading-[0.9] tracking-[-0.06em]">Welcome, {invitation.displayName}.</h1><p className="mt-6 max-w-md text-sm leading-6 text-[var(--muted-ink)]">Join <strong>{invitation.workspace.name}</strong> as {invitation.role.replaceAll("-", " ")}. Your account will use <strong>{invitation.email}</strong>.</p><label className="mt-10 block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">{invitation.existingAccount ? "Confirm your existing password" : "Choose a password"}<input type="password" autoComplete={invitation.existingAccount ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-12 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold normal-case tracking-normal outline-none" /></label>{error ? <p role="alert" className="mt-5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}<button type="button" disabled={pending || password.length < 12} onClick={() => void accept()} className="mt-8 flex h-12 w-full items-center justify-between rounded-[var(--radius)] bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] disabled:opacity-50"><span>{pending ? "Joining…" : "Join the workspace"}</span>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}</button></div> : <div className="mt-16"><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--danger)]">Invitation unavailable</p><h1 className="font-editorial mt-3 text-5xl">This welcome has closed.</h1><p className="mt-5 text-sm text-[var(--muted-ink)]">{error}</p><Link href="/sign-in" className="mt-8 inline-flex text-xs font-bold text-[var(--signal)]">Return to sign in</Link></div>}</section></main>;
}
