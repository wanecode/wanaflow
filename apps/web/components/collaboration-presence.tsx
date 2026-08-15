"use client";

import type { ArtifactEditorPresence } from "@wanaflow/db";
import { CloudOff, Radio, UsersRound } from "lucide-react";

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function CollaborationPresence({
  collaborators,
  connection,
}: {
  collaborators: ArtifactEditorPresence[];
  connection: "connecting" | "live" | "offline" | "retrying";
}) {
  const visible = collaborators.slice(0, 3);
  const connectionCopy = connection === "offline"
    ? "Offline"
    : connection === "retrying"
      ? "Reconnecting"
      : connection === "connecting"
        ? "Joining"
        : collaborators.length
          ? `${collaborators.length + 1} editing`
          : "Just you";

  return (
    <div className="group relative flex items-center gap-2" aria-label={`${connectionCopy} in this draft`}>
      <div className="flex -space-x-1.5">
        {visible.map((entry, index) => (
          <span
            key={entry.id}
            className={`flex size-7 items-center justify-center rounded-full border-2 border-[var(--paper)] text-[0.55rem] font-bold ${index % 2 ? "bg-[#d8c8b8] text-[#5d3e2f]" : "bg-[#c9d5c7] text-[#294532]"}`}
            title={`${entry.principal.displayName}${entry.selectedElement ? ` · ${entry.selectedElement.name}` : ""}`}
          >
            {initials(entry.principal.displayName)}
          </span>
        ))}
        {!visible.length ? (
          <span className="flex size-7 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--paper-raised)] text-[var(--faint-ink)]">
            <UsersRound className="size-3.5" />
          </span>
        ) : null}
      </div>
      <span className={`hidden items-center gap-1.5 text-[0.6rem] font-semibold md:flex ${connection === "offline" || connection === "retrying" ? "text-[var(--gold)]" : "text-[var(--muted-ink)]"}`}>
        {connection === "offline" ? <CloudOff className="size-3" /> : <Radio className={`size-3 ${connection === "connecting" || connection === "retrying" ? "animate-pulse" : ""}`} />}
        {connectionCopy}
      </span>
      {collaborators.length ? (
        <div className="pointer-events-none absolute right-0 top-9 z-40 hidden w-64 rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] p-3 shadow-[0_18px_60px_rgba(27,26,23,0.14)] group-hover:block">
          <p className="px-2 pb-2 text-[0.58rem] font-bold uppercase tracking-[0.15em] text-[var(--faint-ink)]">In this draft</p>
          {collaborators.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span className={`size-2 rounded-full ${entry.state === "ACTIVE" ? "bg-[var(--moss)]" : "bg-[var(--line-strong)]"}`} />
              <span className="min-w-0"><span className="block truncate text-xs font-bold">{entry.principal.displayName}</span><span className="mt-0.5 block truncate text-[0.6rem] text-[var(--muted-ink)]">{entry.isCurrentRevision ? entry.selectedElement?.name ?? "Viewing the draft" : "A previous revision"}</span></span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
