"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

type FormEditorInstance = {
  destroy: () => void;
  importSchema: (schema: Record<string, unknown>) => Promise<{ warnings: unknown[] }>;
  on: (event: string, handler: () => void) => void;
  saveSchema: () => Record<string, unknown>;
};

export type FormEditorCanvasHandle = {
  saveSource: () => string;
  addFields: (fields: Array<Record<string, unknown>>) => Promise<void>;
};

export const FormEditorCanvas = forwardRef<FormEditorCanvasHandle, {
  source: string;
  onDirtyChange: () => void;
}>(function FormEditorCanvas({ source, onDirtyChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<FormEditorInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(ref, () => ({
    saveSource() {
      if (!editorRef.current) throw new Error("The form editor is not ready.");
      return JSON.stringify(editorRef.current.saveSchema(), null, 2);
    },
    async addFields(fields) {
      if (!editorRef.current) throw new Error("The form editor is not ready.");
      const schema = editorRef.current.saveSchema() as { components?: Array<Record<string, unknown>> };
      const components = [...(schema.components ?? [])];
      const keys = new Set(components.flatMap((component) => typeof component.key === "string" ? [component.key] : []));
      const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      components.push(...fields.map((field, index) => {
        const baseKey = typeof field.key === "string" ? field.key : null;
        let key = baseKey;
        let keyIndex = 2;
        while (key && keys.has(key)) key = `${baseKey}${keyIndex++}`;
        if (key) keys.add(key);
        return {
          ...field,
          ...(key ? { key } : {}),
          id: `${String(field.type ?? "Field")}_${suffix}_${index + 1}`,
        };
      }));
      await editorRef.current.importSchema({ ...schema, components });
      onDirtyChange();
    },
  }), [onDirtyChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const mount = async () => {
      try {
        const { FormEditor } = await import("@bpmn-io/form-js");
        if (cancelled) return;
        const editor = new FormEditor({ container }) as unknown as FormEditorInstance;
        editorRef.current = editor;
        await editor.importSchema(JSON.parse(source) as Record<string, unknown>);
        if (cancelled) return;
        editor.on("changed", onDirtyChange);
        setStatus("ready");
      } catch (error) {
        console.error("Unable to load the form editor", error);
        setStatus("error");
      }
    };
    void mount();
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [onDirtyChange, source]);

  return (
    <div className="form-editor-surface relative size-full min-h-[560px] overflow-hidden bg-[var(--paper-raised)]">
      <div ref={containerRef} className="size-full" aria-label="Form builder" />
      {status === "loading" ? <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-raised)] text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin text-[var(--signal)]" /> Preparing the form canvas</div> : null}
      {status === "error" ? <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-[var(--danger)]">The form schema could not be opened.</div> : null}
    </div>
  );
});
