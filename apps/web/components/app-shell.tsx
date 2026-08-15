"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Blocks,
  CircleUserRound,
  Command,
  FileCheck2,
  Inbox,
  LogOut,
  Menu,
  Search,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@wanaflow/ui";

import { authClient } from "@/lib/auth-client";
import { loadInstances, loadLibrary, loadNotifications, loadReviews, loadTasks } from "@/lib/api-client";

import { CommandPalette } from "./command-palette";
import { ThemeSwitcher } from "./theme-switcher";

const navigation = [
  { href: "/", label: "Today", icon: Activity },
  { href: "/library", label: "Studio", icon: Workflow },
  { href: "/reviews", label: "Reviews", icon: FileCheck2 },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/operations", label: "Operations", icon: Blocks },
] as const;

const routeContext: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Workspace", title: "People operations" },
  "/library": { eyebrow: "Studio", title: "Process library" },
  "/reviews": { eyebrow: "Review", title: "Decision room" },
  "/inbox": { eyebrow: "My work", title: "Task inbox" },
  "/operations": { eyebrow: "Production", title: "Runtime operations" },
  "/people": { eyebrow: "Workspace", title: "People and work groups" },
  "/updates": { eyebrow: "Shared attention", title: "Updates" },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = authClient.useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signals, setSignals] = useState<Record<string, number>>({});
  const [canManagePeople, setCanManagePeople] = useState(false);
  const context = useMemo(() => {
    if (pathname.startsWith("/create/")) return { eyebrow: "Wana", title: "Experience studio" };
    if (pathname === "/create") return { eyebrow: "Wana", title: "Create with AI" };
    if (pathname.startsWith("/studio/")) return { eyebrow: "Process", title: "BPMN Studio" };
    if (pathname.startsWith("/decisions/")) return { eyebrow: "Decision", title: "DMN Studio" };
    if (pathname.startsWith("/forms/")) return { eyebrow: "Form", title: "Form Studio" };
    if (pathname.startsWith("/reviews/")) return routeContext["/reviews"];
    if (pathname.startsWith("/operations/")) return { eyebrow: "Production", title: "Instance detail" };
    return routeContext[pathname] ?? routeContext["/"];
  }, [pathname]);
  const displayName = session.data?.user.name ?? "Wanaflow user";
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    void loadLibrary().then(async (library) => {
      if (active) setCanManagePeople(library.permissions.includes("membership:manage"));
      const [reviews, tasks, instances, notifications] = await Promise.all([
        library.permissions.includes("review:read") ? loadReviews() : Promise.resolve([]),
        library.permissions.includes("task:read") ? loadTasks() : Promise.resolve([]),
        library.permissions.includes("instance:read") ? loadInstances() : Promise.resolve([]),
        library.permissions.includes("notification:read") ? loadNotifications(true) : Promise.resolve([]),
      ]);
      if (active) setSignals({
          "/reviews": reviews.filter((review) => review.status === "OPEN").length,
          "/inbox": tasks.length,
          "/operations": instances.filter((instance) => instance.status === "INCIDENT").length,
          "/updates": notifications.length,
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [pathname]);

  return (
    <div className="min-h-screen md:grid md:h-screen md:grid-cols-[64px_minmax(0,1fr)] md:overflow-hidden">
      <div className="app-grain" aria-hidden="true" />

      <aside className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-[var(--line)] bg-[var(--paper-glass-94)] px-2 backdrop-blur-xl md:static md:z-auto md:h-screen md:flex-col md:justify-start md:border-r md:border-t-0 md:px-0 md:py-4">
        <Link
          href="/"
          prefetch={false}
          aria-label="Wanaflow home"
          className="mb-6 hidden size-8 items-center justify-center rounded-[var(--radius)] bg-[var(--ink)] text-[0.6875rem] font-bold tracking-[-0.06em] text-[var(--paper)] md:flex"
        >
          wa
        </Link>

        <nav aria-label="Primary navigation" className="contents md:flex md:flex-col md:gap-1.5">
          {navigation.map((item) => {
            const Icon = item.icon;
            const count = signals[item.href] ?? 0;
            const active = item.href === pathname
              || (item.href === "/library" && ["/studio/", "/decisions/", "/forms/", "/create"].some((prefix) => pathname.startsWith(prefix)))
              || (item.href === "/reviews" && pathname.startsWith("/reviews/"))
              || (item.href === "/operations" && pathname.startsWith("/operations/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-w-14 flex-col items-center gap-1 rounded-[var(--radius)] px-2 py-2 text-[0.625rem] font-semibold text-[var(--muted-ink)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)] md:size-10 md:min-w-0 md:justify-center md:p-0",
                  active && "bg-[var(--wash-strong)] text-[var(--ink)]",
                )}
              >
                <Icon className="size-[18px] stroke-[1.7]" aria-hidden="true" />
                <span className="md:sr-only">{item.label}</span>
                {count ? (
                  <span className="absolute right-1.5 top-1 rounded-full bg-[var(--signal)] px-1 text-[0.55rem] leading-3 text-white md:-right-1 md:-top-1">
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
                <span className="pointer-events-none absolute left-[48px] hidden whitespace-nowrap rounded-[var(--radius)] bg-[var(--ink)] px-2.5 py-1.5 text-[0.6875rem] font-semibold text-[var(--paper)] opacity-0 shadow-md transition-opacity group-hover:opacity-100 md:block">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden flex-col items-center gap-3 md:flex">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex size-9 items-center justify-center rounded-[var(--radius)] text-[var(--muted-ink)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)]"
            aria-label="Open command palette"
          >
            <Search className="size-[18px] stroke-[1.7]" />
          </button>
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-full bg-[#c9d5c7] text-xs font-bold text-[#294532] ring-2 ring-[var(--paper)]"
            aria-label={`Open ${displayName} account menu`}
          >
            {initials}
          </button>
        </div>
      </aside>

      <div className="grid min-h-screen min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)] md:h-screen md:min-h-0">
        <header className="z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-glass-92)] px-4 backdrop-blur-xl md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              className="flex size-9 items-center justify-center rounded-full hover:bg-[var(--wash)] md:hidden"
              aria-label="Toggle workspace menu"
            >
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
            <p className="min-w-0 truncate text-xs text-[var(--muted-ink)]"><span>{context.eyebrow}</span><span className="mx-2 text-[var(--line-strong)]">/</span><strong className="font-semibold text-[var(--ink)]">{context.title}</strong></p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitcher />
            <Link href="/updates" prefetch={false} aria-label="Open updates" className="relative flex size-9 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]">
              <Bell className="size-[18px] stroke-[1.7]" />
              {signals["/updates"] ? <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-[var(--signal)] ring-2 ring-[var(--paper)]" /> : null}
            </Link>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-8 items-center gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--paper-raised)] px-2.5 text-[0.6875rem] font-medium text-[var(--muted-ink)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)] sm:flex"
            >
              <Command className="size-3.5" />
              Jump to
              <kbd className="ml-1 rounded bg-[var(--wash)] px-1.5 py-0.5 font-mono text-[0.6rem]">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              className="flex size-9 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)] md:hidden"
              aria-label={`Open ${displayName} account menu`}
            >
              <CircleUserRound className="size-5 stroke-[1.6]" />
            </button>
          </div>
        </header>

        {mobileOpen ? (
          <div className="absolute inset-x-3 top-16 z-40 rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--paper-raised)] p-2 shadow-lg md:hidden">
            <Link href="/library" prefetch={false} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-[var(--wash)]">
              <Workflow className="size-4" /> Process library
            </Link>
            <Link href="/inbox" prefetch={false} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold hover:bg-[var(--wash)]">
              <Inbox className="size-4" /> My open work
            </Link>
          </div>
        ) : null}

        <main className="min-h-0 min-w-0 overflow-auto">{children}</main>
      </div>

      {accountOpen ? (
        <section className="fixed bottom-20 right-4 z-50 w-72 rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--paper-raised)] p-2 shadow-xl md:bottom-4 md:left-[56px] md:right-auto" aria-label="Account menu">
          <div className="border-b border-[var(--line)] px-3 py-3">
            <p className="truncate text-xs font-bold">{displayName}</p>
            <p className="mt-1 truncate text-[0.625rem] text-[var(--muted-ink)]">{session.data?.user.email}</p>
          </div>
          <Link href="/updates" prefetch={false} onClick={() => setAccountOpen(false)} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-semibold text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"><Bell className="size-4" /> Updates{signals["/updates"] ? <span className="ml-auto rounded-full bg-[var(--signal-wash)] px-2 py-0.5 text-[0.6rem] font-bold text-[var(--signal)]">{signals["/updates"]}</span> : null}</Link>
          {canManagePeople ? <Link href="/people" prefetch={false} onClick={() => setAccountOpen(false)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-semibold text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"><UsersRound className="size-4" /> People and groups</Link> : null}
          <button type="button" onClick={async () => { await authClient.signOut(); router.replace("/sign-in"); router.refresh(); }} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-semibold text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"><LogOut className="size-4" /> Sign out</button>
        </section>
      ) : null}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
