"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@wanaflow/ui";

type DmnView = { id?: string; type?: string; element?: { id?: string; name?: string } };
type DmnInstance = {
  destroy: () => void;
  importXML: (xml: string) => Promise<{ warnings?: unknown[] }>;
  saveXML: (options: { format: boolean }) => Promise<{ xml?: string }>;
  getViews: () => DmnView[];
  open: (view: DmnView) => Promise<unknown>;
  getActiveViewer?: () => { get: (service: string) => unknown } | null;
  on?: (event: string, callback: (event: unknown) => void) => void;
};
type DmnConstructor = new (options: { container: HTMLElement; keyboard?: { bindTo: Document } }) => DmnInstance;

export type DmnSelectedElement = { id: string; name: string; type: string };
export type DmnCanvasHandle = { saveXml: () => Promise<string> };

export const DmnCanvas = forwardRef<DmnCanvasHandle, {
  xml: string;
  mode?: "edit" | "view";
  onDirtyChange?: () => void;
  onSelectionChange?: (element: DmnSelectedElement | null) => void;
  className?: string;
}>(function DmnCanvas({ xml, mode = "edit", onDirtyChange, onSelectionChange, className }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<DmnInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(ref, () => ({
    async saveXml() {
      const result = await instanceRef.current?.saveXML({ format: true });
      if (!result?.xml) throw new Error("The DMN modeler did not return XML.");
      return result.xml;
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const mount = async () => {
      try {
        const dmnModule = mode === "edit"
          ? await import("dmn-js/lib/Modeler")
          : await import("dmn-js/lib/Viewer");
        if (cancelled) return;
        const Constructor = dmnModule.default as unknown as DmnConstructor;
        const instance = new Constructor({ container, ...(mode === "edit" ? { keyboard: { bindTo: document } } : {}) });
        instanceRef.current = instance;
        const imported = await instance.importXML(xml);
        const views = instance.getViews();
        const table = views.find((view) => view.type === "decisionTable") ?? views[0];
        if (table) await instance.open(table);
        if (cancelled) return;
        const element = table?.element;
        if (element?.id && onSelectionChange) {
          onSelectionChange({ id: element.id, name: element.name || element.id, type: "Decision" });
        }
        if (mode === "edit" && onDirtyChange) {
          const eventBus = instance.getActiveViewer?.()?.get("eventBus") as { on?: (event: string, callback: () => void) => void } | undefined;
          eventBus?.on?.("commandStack.changed", onDirtyChange);
        }
        if (imported.warnings?.length) console.info("DMN import warnings", imported.warnings);
        setStatus("ready");
      } catch (error) {
        console.error("Unable to load DMN canvas", error);
        setStatus("error");
      }
    };
    void mount();
    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [mode, onDirtyChange, onSelectionChange, xml]);

  return (
    <div className={cn("dmn-surface relative size-full min-h-[440px] overflow-hidden bg-[var(--paper-raised)]", mode === "view" && "dmn-readonly", className)}>
      <div ref={containerRef} className="size-full" aria-label="DMN decision table" />
      {status === "loading" ? <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-raised)] text-xs font-semibold text-[var(--muted-ink)]"><span className="mr-3 size-2 animate-pulse rounded-full bg-[var(--signal)]" /> Preparing the decision table</div> : null}
      {status === "error" ? <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[var(--danger)]">The decision table could not be loaded.</div> : null}
    </div>
  );
});
