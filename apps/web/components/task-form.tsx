"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

type FormInstance = {
  destroy: () => void;
  importSchema: (schema: Record<string, unknown>, data: Record<string, unknown>) => Promise<unknown>;
  submit: () => { data: Record<string, unknown>; errors: Record<string, unknown> };
};

export type TaskFormHandle = {
  submit: () => { data: Record<string, unknown>; valid: boolean };
};

export const TaskForm = forwardRef<TaskFormHandle, {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
}>(function TaskForm({ schema, data }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<FormInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(ref, () => ({
    submit() {
      if (!formRef.current) return { data: {}, valid: false };
      const result = formRef.current.submit();
      return { data: result.data, valid: Object.keys(result.errors).length === 0 };
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const mount = async () => {
      try {
        const { Form } = await import("@bpmn-io/form-js");
        if (cancelled) return;
        const form = new Form({ container }) as unknown as FormInstance;
        formRef.current = form;
        await form.importSchema(schema, data);
        if (!cancelled) setStatus("ready");
      } catch (error) {
        console.error("Unable to render the task form", error);
        setStatus("error");
      }
    };
    void mount();
    return () => {
      cancelled = true;
      formRef.current?.destroy();
      formRef.current = null;
    };
  }, [data, schema]);

  return (
    <div className="task-form-surface relative min-h-40">
      <div ref={containerRef} aria-label="Task form" />
      {status === "loading" ? <div className="flex min-h-40 items-center justify-center text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin text-[var(--signal)]" /> Opening the form</div> : null}
      {status === "error" ? <p className="rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">This deployed form could not be rendered.</p> : null}
    </div>
  );
});
