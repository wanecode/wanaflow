"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Blocks,
  FileCheck2,
  Inbox,
  Search,
  Workflow,
  X,
} from "lucide-react";

const commands = [
  { href: "/library", label: "Open the process library", hint: "BPMN Studio", icon: Workflow },
  { href: "/reviews", label: "Review Employee onboarding v4", hint: "Approval", icon: FileCheck2 },
  { href: "/inbox", label: "Open my task inbox", hint: "4 open", icon: Inbox },
  { href: "/operations", label: "Inspect payment-sync incident", hint: "Production", icon: Blocks },
] as const;

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () =>
      commands.filter((command) =>
        `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-[rgba(27,26,23,0.26)] px-4 pt-[14vh] backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onOpenChange(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[620px] overflow-hidden rounded-[22px] border border-white/70 bg-[var(--paper-raised)] shadow-[0_30px_100px_rgba(27,26,23,0.24)]"
      >
        <div className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-5">
          <Search className="size-[18px] stroke-[1.6] text-[var(--faint-ink)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a process, task, review, or command…"
            className="min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium outline-none placeholder:text-[var(--faint-ink)]"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]"
            aria-label="Close command palette"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-2">
          <p className="px-3 pb-2 pt-3 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">
            {query ? "Matches" : "Suggested"}
          </p>
          {filtered.length ? (
            filtered.map((command) => {
              const Icon = command.icon;
              return (
                <Link
                  key={command.href}
                  href={command.href}
                  prefetch={false}
                  onClick={() => onOpenChange(false)}
                  className="group flex items-center gap-3 rounded-[14px] px-3 py-3 hover:bg-[var(--wash)]"
                >
                  <span className="flex size-9 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] text-[var(--muted-ink)] group-hover:text-[var(--signal)]">
                    <Icon className="size-4 stroke-[1.7]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold tracking-[-0.02em]">
                      {command.label}
                    </span>
                    <span className="block text-[0.6875rem] text-[var(--muted-ink)]">
                      {command.hint}
                    </span>
                  </span>
                  <span className="text-[0.6875rem] font-semibold text-[var(--faint-ink)] opacity-0 transition-opacity group-hover:opacity-100">
                    Open ↗
                  </span>
                </Link>
              );
            })
          ) : (
            <p className="px-3 py-10 text-center text-sm text-[var(--muted-ink)]">
              Nothing found. Try a process or task name.
            </p>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3 text-[0.625rem] font-semibold text-[var(--faint-ink)]">
          <span>Search follows your permissions</span>
          <span>Esc to close</span>
        </footer>
      </section>
    </div>
  );
}
