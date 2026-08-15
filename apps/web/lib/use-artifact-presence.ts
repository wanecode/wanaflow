"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactEditorPresence } from "@wanaflow/db";

import { leaveArtifactPresence, touchArtifactPresence } from "./api-client";

type SelectedElement = { id: string; name: string; type: string } | null;
type Cursor = { x: number; y: number } | null;

export function useArtifactPresence(input: {
  artifactId: string | null;
  revisionId: string | null;
  selectedElement: SelectedElement;
  cursor?: Cursor;
}) {
  const artifactId = input.artifactId;
  const revisionId = input.revisionId;
  const selectedElementId = input.selectedElement?.id ?? null;
  const cursor = input.cursor ?? null;
  const [clientId] = useState(() => `studio_${crypto.randomUUID().replaceAll("-", "")}`);
  const [presence, setPresence] = useState<ArtifactEditorPresence[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline" | "retrying">(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "connecting",
  );
  const liveState = useRef({ revisionId, selectedElementId, cursor });
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    liveState.current = { revisionId, selectedElementId, cursor };
  }, [cursor, revisionId, selectedElementId]);

  const heartbeat = useCallback(async (state: "ACTIVE" | "IDLE" = "ACTIVE") => {
    const current = liveState.current;
    if (!artifactId || !current.revisionId || !navigator.onLine) {
      setConnection("offline");
      return;
    }
    try {
      const next = await touchArtifactPresence(artifactId, {
        revisionId: current.revisionId,
        clientId,
        selectedElementId: current.selectedElementId,
        cursor: current.cursor,
        state,
      });
      setPresence(next);
      setConnection("live");
    } catch {
      setConnection(navigator.onLine ? "retrying" : "offline");
    }
  }, [artifactId, clientId]);

  useEffect(() => {
    if (!artifactId) return;
    const activeClientId = clientId;
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`wanaflow:presence:${artifactId}`);
    channelRef.current = channel;
    const onVisibility = () => void heartbeat(document.hidden ? "IDLE" : "ACTIVE");
    const onOnline = () => void heartbeat(document.hidden ? "IDLE" : "ACTIVE");
    const onOffline = () => setConnection("offline");
    const interval = window.setInterval(
      () => void heartbeat(document.hidden ? "IDLE" : "ACTIVE"),
      2_000,
    );
    channel?.addEventListener("message", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const initial = window.setTimeout(() => void heartbeat(document.hidden ? "IDLE" : "ACTIVE"), 0);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initial);
      channel?.postMessage({ type: "left", clientId: activeClientId });
      channel?.close();
      channelRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      void leaveArtifactPresence(artifactId, activeClientId);
    };
  }, [artifactId, clientId, heartbeat]);

  useEffect(() => {
    if (!artifactId || !revisionId) return;
    const timeout = window.setTimeout(() => void heartbeat("ACTIVE"), cursor ? 180 : 60);
    return () => window.clearTimeout(timeout);
  }, [artifactId, cursor, heartbeat, revisionId, selectedElementId]);

  const collaborators = useMemo(() => {
    const currentPrincipalId = presence.find((entry) => entry.clientId === clientId)?.principal.id;
    const people = new Map<string, ArtifactEditorPresence>();

    for (const entry of presence) {
      if (entry.clientId === clientId || entry.principal.id === currentPrincipalId) continue;
      const previous = people.get(entry.principal.id);
      const entrySignal = Number(entry.state === "ACTIVE") + Number(entry.isCurrentRevision) + Number(Boolean(entry.cursor)) + Number(Boolean(entry.selectedElement));
      const previousSignal = previous
        ? Number(previous.state === "ACTIVE") + Number(previous.isCurrentRevision) + Number(Boolean(previous.cursor)) + Number(Boolean(previous.selectedElement))
        : -1;
      if (!previous || entrySignal > previousSignal || (entrySignal === previousSignal && entry.lastSeenAt > previous.lastSeenAt)) {
        people.set(entry.principal.id, entry);
      }
    }

    return [...people.values()];
  }, [clientId, presence]);
  const currentRevisionId = presence[0]?.currentRevisionId ?? revisionId;
  const announceRevision = useCallback(() => {
    channelRef.current?.postMessage({ type: "revision-saved", clientId });
    void heartbeat("ACTIVE");
  }, [clientId, heartbeat]);

  return {
    clientId,
    collaborators,
    connection,
    currentRevisionId,
    refreshPresence: heartbeat,
    announceRevision,
  };
}
