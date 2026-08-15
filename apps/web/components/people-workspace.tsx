"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MembershipRole, OrganizationInvitation, WorkGroup, WorkspaceMember } from "@wanaflow/db";
import {
  ArrowRight,
  Check,
  Clipboard,
  LoaderCircle,
  MailPlus,
  Plus,
  UsersRound,
  X,
} from "lucide-react";
import { Button } from "@wanaflow/ui";

import {
  createWorkGroup,
  invitePerson,
  loadLibrary,
  loadPeople,
  revokeInvitation,
  updateWorkGroup,
} from "@/lib/api-client";

const roleCopy: Record<MembershipRole, string> = {
  "organization-owner": "Organization owner",
  "workspace-admin": "Workspace steward",
  designer: "Process designer",
  reviewer: "Reviewer",
  operator: "Operator",
  "task-worker": "Task worker",
};

function stableKey(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

export function PeopleWorkspace() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WorkGroup | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Exclude<MembershipRole, "organization-owner">>("designer");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [groupKeyTouched, setGroupKeyTouched] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [renderedAt] = useState(() => Date.now());

  const refresh = useCallback(async (targetWorkspaceId: string) => {
    const data = await loadPeople(targetWorkspaceId);
    setMembers(data.members);
    setInvitations(data.invitations);
    setGroups(data.groups);
  }, []);

  useEffect(() => {
    let active = true;
    void loadLibrary().then(async (library) => {
      const workspace = library.workspaces[0];
      if (!workspace) throw new Error("No workspace is available.");
      const data = await loadPeople(workspace.id);
      if (!active) return;
      setWorkspaceId(workspace.id);
      setWorkspaceName(workspace.name);
      setMembers(data.members);
      setInvitations(data.invitations);
      setGroups(data.groups);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "People could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const pendingInvitations = invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt && new Date(invitation.expiresAt).getTime() > renderedAt);
  const groupEligibleMembers = useMemo(
    () => members.filter((member) => member.role !== "reviewer"),
    [members],
  );

  const openInvite = () => {
    setEmail("");
    setDisplayName("");
    setRole("designer");
    setInviteLink(null);
    setError(null);
    setInviteOpen(true);
  };

  const sendInvite = async () => {
    setPending(true);
    setError(null);
    try {
      const invitation = await invitePerson({ workspaceId, email, displayName, role });
      setInviteLink(`${window.location.origin}${invitation.acceptUrl}`);
      await refresh(workspaceId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be created.");
    } finally {
      setPending(false);
    }
  };

  const openGroup = (group?: WorkGroup) => {
    setEditingGroup(group ?? null);
    setGroupName(group?.name ?? "");
    setGroupKey(group?.key ?? "");
    setGroupKeyTouched(Boolean(group));
    setMemberIds(group?.members.map((member) => member.id) ?? []);
    setError(null);
    setGroupOpen(true);
  };

  const saveGroup = async () => {
    setPending(true);
    setError(null);
    try {
      if (editingGroup) await updateWorkGroup(editingGroup.id, { name: groupName, memberIds });
      else await createWorkGroup({ workspaceId, key: groupKey, name: groupName, memberIds });
      await refresh(workspaceId);
      setGroupOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The group could not be saved.");
    } finally {
      setPending(false);
    }
  };

  if (loading) return <div className="workspace-page flex min-h-full items-center justify-center text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin text-[var(--signal)]" /> Opening the team</div>;

  return (
    <div className="workspace-page mx-auto min-h-full w-full max-w-[1180px] px-5 pb-24 pt-10 sm:px-8 md:px-12 md:pt-14">
      <header className="flex flex-col gap-8 border-b border-[var(--line-strong)] pb-10 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">{workspaceName} · shared work</p><h1 className="font-editorial mt-4 text-[clamp(3.5rem,6vw,6.4rem)] font-[470] leading-[0.87] tracking-[-0.06em]">The people in the process.</h1><p className="mt-6 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">Invite with intention, give each person a clear role, and gather task workers into named queues that make ownership visible.</p></div>
        <Button variant="primary" onClick={openInvite}><MailPlus className="size-4" /> Invite someone</Button>
      </header>

      {error && !inviteOpen && !groupOpen ? <p role="alert" className="mt-6 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

      <section className="grid gap-10 border-b border-[var(--line-strong)] py-10 lg:grid-cols-[0.75fr_1.25fr]">
        <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">People · {members.length}</p><h2 className="font-editorial mt-3 text-4xl font-medium tracking-[-0.05em]">One workspace, distinct responsibilities.</h2></div>
        <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {members.map((member) => <div key={member.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-4"><span className="flex size-9 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[0.625rem] font-bold text-[var(--moss)]">{member.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><span className="min-w-0"><span className="block truncate text-sm font-bold">{member.displayName}</span><span className="mt-1 block truncate text-[0.625rem] text-[var(--muted-ink)]">{member.email}</span></span><span className="text-right text-[0.625rem] font-semibold text-[var(--faint-ink)]">{roleCopy[member.role]}</span></div>)}
        </div>
      </section>

      <section className="grid gap-10 border-b border-[var(--line-strong)] py-10 lg:grid-cols-[0.75fr_1.25fr]">
        <div><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">Task queues</p><h2 className="font-editorial mt-3 text-4xl font-medium tracking-[-0.05em]">Let the right group claim it.</h2><button type="button" onClick={() => openGroup()} className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-[var(--signal)]"><Plus className="size-3.5" /> New work group</button></div>
        <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {groups.map((group) => <button key={group.id} type="button" onClick={() => openGroup(group)} className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-5 text-left"><span className="flex size-9 items-center justify-center rounded-full bg-[var(--signal-wash)] text-[var(--signal)]"><UsersRound className="size-4" /></span><span><span className="block text-sm font-bold">{group.name}</span><span className="mt-1 block font-mono text-[0.625rem] text-[var(--faint-ink)]">{group.key}</span></span><span className="text-[0.625rem] font-semibold text-[var(--muted-ink)]">{group.members.length} member{group.members.length === 1 ? "" : "s"} <ArrowRight className="ml-1 inline size-3" /></span></button>)}
          {!groups.length ? <div className="py-8 text-sm leading-6 text-[var(--muted-ink)]">No shared queues yet. Create one for work such as Finance review, People operations, or Incident response.</div> : null}
        </div>
      </section>

      {pendingInvitations.length ? <section className="grid gap-10 py-10 lg:grid-cols-[0.75fr_1.25fr]"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--gold)]">Waiting to join · {pendingInvitations.length}</p><h2 className="font-editorial mt-3 text-4xl font-medium tracking-[-0.05em]">The invitation is still open.</h2></div><div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{pendingInvitations.map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-4 py-4"><span className="min-w-0"><span className="block truncate text-sm font-bold">{invitation.displayName}</span><span className="mt-1 block truncate text-[0.625rem] text-[var(--muted-ink)]">{invitation.email} · {roleCopy[invitation.role]}</span></span><button type="button" onClick={async () => { await revokeInvitation(invitation.id); await refresh(workspaceId); }} className="text-[0.625rem] font-bold text-[var(--danger)]">Withdraw</button></div>)}</div></section> : null}

      {inviteOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-30)] backdrop-blur-[3px]"><section role="dialog" aria-modal="true" aria-labelledby="invite-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)]"><header className="flex items-start justify-between border-b border-[var(--line)] px-6 py-7 sm:px-8"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">A considered welcome</p><h2 id="invite-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">Invite someone into the work.</h2></div><button type="button" onClick={() => setInviteOpen(false)} aria-label="Close invitation"><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-7 overflow-auto px-6 py-8 sm:px-8">{inviteLink ? <div><span className="flex size-11 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><Check className="size-5" /></span><h3 className="font-editorial mt-5 text-3xl">The invitation is ready.</h3><p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">Share this private, seven-day link with {displayName}. Email delivery can be connected later without changing the invitation contract.</p><div className="mt-6 flex items-center gap-2 border-y border-[var(--line)] py-4"><code className="min-w-0 flex-1 truncate text-[0.625rem]">{inviteLink}</code><button type="button" aria-label="Copy invitation link" onClick={async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true); }} className="flex size-9 items-center justify-center rounded-full bg-[var(--wash)]">{copied ? <Check className="size-4 text-[var(--moss)]" /> : <Clipboard className="size-4" />}</button></div></div> : <><label className="block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-2 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold normal-case tracking-normal outline-none" /></label><label className="block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold normal-case tracking-normal outline-none" /></label><label className="block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Role<select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="mt-2 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold normal-case tracking-normal outline-none"><option value="designer">Process designer</option><option value="reviewer">Reviewer</option><option value="operator">Operator</option><option value="task-worker">Task worker</option><option value="workspace-admin">Workspace steward</option></select></label></>}{error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}</div><footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><Button variant="quiet" onClick={() => setInviteOpen(false)}>{inviteLink ? "Done" : "Cancel"}</Button>{!inviteLink ? <Button variant="signal" disabled={pending || !displayName || !email} onClick={() => void sendInvite()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <MailPlus className="size-3.5" />} Create invitation</Button> : null}</footer></section></div> : null}

      {groupOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-30)] backdrop-blur-[3px]"><section role="dialog" aria-modal="true" aria-labelledby="group-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)]"><header className="flex items-start justify-between border-b border-[var(--line)] px-6 py-7 sm:px-8"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--moss)]">Claimable work</p><h2 id="group-title" className="font-editorial mt-2 text-4xl font-medium tracking-[-0.055em]">{editingGroup ? "Shape this work group." : "Create a shared queue."}</h2></div><button type="button" onClick={() => setGroupOpen(false)} aria-label="Close group"><X className="size-4" /></button></header><div className="min-h-0 flex-1 space-y-7 overflow-auto px-6 py-8 sm:px-8"><label className="block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Group name<input value={groupName} onChange={(event) => { setGroupName(event.target.value); if (!groupKeyTouched) setGroupKey(stableKey(event.target.value)); }} className="mt-2 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent text-sm font-semibold normal-case tracking-normal outline-none" /></label><label className="block text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Stable key<input value={groupKey} disabled={Boolean(editingGroup)} onChange={(event) => { setGroupKeyTouched(true); setGroupKey(event.target.value); }} className="mt-2 h-11 w-full border-0 border-b border-[var(--line-strong)] bg-transparent font-mono text-xs normal-case tracking-normal outline-none disabled:text-[var(--faint-ink)]" /></label><fieldset><legend className="text-[0.625rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">Who can claim this work?</legend><div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{groupEligibleMembers.map((member) => <label key={member.id} className="flex cursor-pointer items-center justify-between gap-4 py-3 text-sm font-semibold"><span>{member.displayName}<span className="ml-2 text-[0.625rem] font-normal text-[var(--faint-ink)]">{roleCopy[member.role]}</span></span><input type="checkbox" checked={memberIds.includes(member.id)} onChange={() => setMemberIds((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])} /></label>)}</div></fieldset>{error ? <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}</div><footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><Button variant="quiet" onClick={() => setGroupOpen(false)}>Cancel</Button><Button variant="signal" disabled={pending || !groupName || !groupKey || !memberIds.length} onClick={() => void saveGroup()}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <UsersRound className="size-3.5" />} Save work group</Button></footer></section></div> : null}
    </div>
  );
}
