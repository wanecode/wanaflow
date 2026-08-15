"use client";

import { useCallback, useEffect, useState } from "react";
import type { WanaflowNotification } from "@wanaflow/db";
import { Bell, Check, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { loadNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api-client";

function relative(value: string, renderedAt: number) {
  const minutes = Math.max(0, Math.round((renderedAt - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}

export function NotificationInbox() {
  const router = useRouter();
  const [items, setItems] = useState<WanaflowNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    try { setItems(await loadNotifications(unreadOnly)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Updates could not be loaded."); }
    finally { setLoading(false); }
  }, [unreadOnly]);
  useEffect(() => {
    let active = true;
    loadNotifications(unreadOnly)
      .then((next) => { if (active) { setItems(next); setError(null); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Updates could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [unreadOnly]);
  const open = async (item: WanaflowNotification) => {
    if (!item.readAt) await markNotificationRead(item.id);
    router.push(item.href);
  };
  return <div className="workspace-page mx-auto min-h-full w-full max-w-[980px] px-5 pb-24 pt-10 sm:px-8 md:px-12 md:pt-14"><header className="flex flex-col gap-7 border-b border-[var(--line-strong)] pb-10 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-[var(--signal)]">Shared attention</p><h1 className="font-editorial mt-4 text-[clamp(3.5rem,7vw,6.5rem)] font-[470] leading-[0.87] tracking-[-0.06em]">What changed around you.</h1><p className="mt-6 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">Mentions, decisions, handoffs, and incidents—one calm record that leads directly back to the work.</p></div><button type="button" onClick={async () => { await markAllNotificationsRead(); await refresh(); }} className="flex items-center gap-2 text-xs font-bold"><Check className="size-3.5" /> Mark all read</button></header><div className="flex items-center gap-5 border-b border-[var(--line)] py-5 text-xs font-bold"><button type="button" onClick={() => setUnreadOnly(false)} className={!unreadOnly ? "border-b-2 border-[var(--signal)] pb-1" : "pb-1 text-[var(--faint-ink)]"}>All updates</button><button type="button" onClick={() => setUnreadOnly(true)} className={unreadOnly ? "border-b-2 border-[var(--signal)] pb-1" : "pb-1 text-[var(--faint-ink)]"}>Unread</button></div>{loading ? <p className="flex items-center py-12 text-xs text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin" /> Gathering updates</p> : error ? <p role="alert" className="py-12 text-sm text-[var(--danger)]">{error}</p> : items.length ? <div className="divide-y divide-[var(--line)]">{items.map((item) => <button type="button" key={item.id} onClick={() => void open(item)} className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-4 py-5 text-left"><span className={`flex size-9 items-center justify-center rounded-full ${item.readAt ? "bg-[var(--wash)] text-[var(--faint-ink)]" : "bg-[var(--signal-wash)] text-[var(--signal)]"}`}><Bell className="size-4" /></span><span><span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--muted-ink)]">{item.body}</span></span><span className="whitespace-nowrap text-[0.625rem] font-semibold text-[var(--faint-ink)]">{relative(item.createdAt, renderedAt)}</span></button>)}</div> : <div className="py-20 text-center"><span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--moss-wash)] text-[var(--moss)]"><Check className="size-5" /></span><h2 className="font-editorial mt-6 text-4xl">You are caught up.</h2><p className="mt-3 text-sm text-[var(--muted-ink)]">New requests and handoffs will arrive here.</p></div>}</div>;
}
