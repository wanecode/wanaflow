"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artifact } from "@wanaflow/db";
import { ArrowLeft, Check, Eye, FileText, Laptop, LoaderCircle, Save, ShieldCheck, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@wanaflow/ui";

import { FormEditorCanvas, type FormEditorCanvasHandle } from "./form-editor-canvas";
import { CollaborationPresence } from "./collaboration-presence";
import { TaskForm } from "./task-form";
import { loadArtifact, saveArtifact, WanaflowApiError } from "@/lib/api-client";
import { useArtifactPresence } from "@/lib/use-artifact-presence";

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

export function FormStudioWorkspace({ artifactId }: { artifactId: string }) {
  const editorRef = useRef<FormEditorCanvasHandle>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [previewSchema, setPreviewSchema] = useState<Record<string, unknown> | null>(null);
  const { collaborators, connection } = useArtifactPresence({
    artifactId: artifact?.id ?? null,
    revisionId: artifact?.revision.id ?? null,
    selectedElement: null,
  });

  useEffect(() => {
    let active = true;
    loadArtifact(artifactId).then((loaded) => {
      if (!active) return;
      if (loaded.type !== "FORM") throw new Error("This artifact is not a form.");
      setArtifact(loaded);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "The form could not be opened.");
    });
    return () => { active = false; };
  }, [artifactId]);

  const dirty = useCallback(() => setSaveState((state) => state === "saving" ? state : "dirty"), []);
  const save = useCallback(async () => {
    if (!artifact || !editorRef.current || saveState === "saving") return;
    setSaveState("saving");
    setError(null);
    try {
      const saved = await saveArtifact(artifact.id, artifact.revision.id, editorRef.current.saveSource());
      setArtifact(saved);
      setSaveState("saved");
    } catch (caught) {
      setSaveState(caught instanceof WanaflowApiError && caught.code === "REVISION_CONFLICT" ? "conflict" : "error");
      setError(caught instanceof Error ? caught.message : "The form could not be saved.");
    }
  }, [artifact, saveState]);

  useEffect(() => {
    if (saveState !== "dirty" || connection === "offline" || connection === "retrying") return;
    const timeout = window.setTimeout(() => void save(), 1_400);
    return () => window.clearTimeout(timeout);
  }, [connection, save, saveState]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [save]);

  const preview = () => {
    try {
      setPreviewSchema(JSON.parse(editorRef.current?.saveSource() ?? artifact?.revision.source ?? "{}") as Record<string, unknown>);
    } catch {
      setError("The current form could not be previewed.");
    }
  };

  const addRecipe = async (recipe: "approval" | "request" | "contact") => {
    const fields = recipe === "approval"
      ? [
          { type: "radio", key: "decision", label: "Decision", values: [{ label: "Approve", value: "approved" }, { label: "Request changes", value: "changes-requested" }], validate: { required: true } },
          { type: "textarea", key: "decisionNote", label: "Decision note" },
        ]
      : recipe === "contact"
        ? [
            { type: "textfield", key: "fullName", label: "Full name", validate: { required: true } },
            { type: "textfield", key: "email", label: "Email", validate: { required: true } },
          ]
        : [
            { type: "textfield", key: "requestTitle", label: "Request", validate: { required: true } },
            { type: "textarea", key: "requestDetails", label: "Details", validate: { required: true } },
          ];
    await editorRef.current?.addFields(fields);
  };

  if (error && !artifact) return <div className="workspace-page flex min-h-[640px] items-center justify-center px-6 text-center"><div><p className="font-editorial text-4xl">This form stayed closed.</p><p className="mt-3 text-sm text-[var(--muted-ink)]">{error}</p><Link href="/library" className="mt-6 inline-flex text-xs font-bold text-[var(--signal)]">Return to Library</Link></div></div>;
  if (!artifact) return <div className="workspace-page flex min-h-[640px] items-center justify-center text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="mr-2 size-4 animate-spin text-[var(--signal)]" /> Opening the form</div>;

  const validation = artifact.revision.validation;
  const fieldCount = (() => {
    try {
      const schema = JSON.parse(artifact.revision.source) as { components?: Array<{ key?: string }> };
      return schema.components?.filter((component) => component.key).length ?? 0;
    } catch { return 0; }
  })();

  return (
    <div className="workspace-page grid h-full min-h-[640px] grid-rows-[52px_minmax(0,1fr)_30px] overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3"><Link href="/library" className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)]" aria-label="Back to library"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><h1 className="truncate text-sm font-semibold tracking-[-0.025em]">{artifact.name}</h1><p className="text-[0.625rem] font-semibold text-[var(--muted-ink)]">FORM · Draft revision {artifact.revision.number}</p></div></div>
        <div className="flex items-center gap-3"><CollaborationPresence collaborators={collaborators} connection={connection} /><span className={`hidden items-center gap-1.5 text-[0.625rem] font-semibold sm:flex ${saveState === "error" || saveState === "conflict" ? "text-[var(--danger)]" : saveState === "dirty" ? "text-[var(--gold)]" : "text-[var(--moss)]"}`}>{saveState === "saving" ? <LoaderCircle className="size-3 animate-spin" /> : saveState === "saved" ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}{saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "dirty" ? "Autosaving…" : saveState === "conflict" ? "Newer revision available" : "Save failed"}</span><Button variant="quiet" size="sm" onClick={preview}><Eye className="size-3.5" /> Preview</Button>{saveState !== "saved" ? <Button variant="primary" size="sm" onClick={() => void save()} disabled={saveState === "saving"}><Save className="size-3.5" /> Save</Button> : null}</div>
      </header>
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_256px]">
        <div className="hidden min-h-0 lg:block"><FormEditorCanvas key={artifact.revision.id} ref={editorRef} source={artifact.revision.source} onDirtyChange={dirty} /></div>
        <div className="flex min-h-0 items-center justify-center px-8 text-center lg:hidden"><div className="max-w-sm"><span className="mx-auto flex size-11 items-center justify-center rounded-[var(--radius)] bg-[var(--signal-wash)] text-[var(--signal)]"><Laptop className="size-5" /></span><h2 className="mt-5 text-xl font-semibold">Continue on a larger screen.</h2><p className="mt-3 text-sm leading-6 text-[var(--muted-ink)]">The form palette, canvas, and field properties need room to work together.</p><Link href="/library" className="mt-5 inline-flex text-xs font-semibold text-[var(--ink)]">Return to Library</Link></div></div>
        <aside className="hidden border-l border-[var(--line)] bg-[var(--paper)] px-5 py-6 lg:block">
          <p className="section-label">Form guide</p><h2 className="mt-2 text-base font-semibold">Ask only what the work needs.</h2><p className="mt-2 text-[0.6875rem] leading-5 text-[var(--muted-ink)]">Task mappings stay in the process; the form remains reusable.</p>
          <dl className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)] text-[0.6875rem]"><div className="flex items-center justify-between py-3"><dt className="text-[var(--muted-ink)]">Data fields</dt><dd className="font-semibold">{fieldCount}</dd></div><div className="flex items-center justify-between py-3"><dt className="text-[var(--muted-ink)]">Schema</dt><dd className="font-mono text-[0.625rem]">form-js 19</dd></div></dl>
          <div className="mt-6"><p className="flex items-center gap-2 text-[0.6875rem] font-semibold text-[var(--muted-ink)]"><Sparkles className="size-3" /> Field kits</p><div className="mt-2 divide-y divide-[var(--line)] border-y border-[var(--line)]">{[["request", "Request details"], ["approval", "Approval decision"], ["contact", "Contact details"]].map(([recipe, label]) => <button key={recipe} type="button" onClick={() => void addRecipe(recipe as "approval" | "request" | "contact")} className="flex w-full items-center justify-between py-2.5 text-left text-[0.6875rem] font-semibold hover:text-[var(--signal)]"><span>{label}</span><span className="text-[0.6rem] text-[var(--faint-ink)]">Add</span></button>)}</div></div>
          <div className="mt-6 flex gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--moss-wash)] text-[var(--moss)]"><ShieldCheck className="size-3.5" /></span><div><p className="text-[0.6875rem] font-semibold">Pinned revision</p><p className="mt-1 text-[0.625rem] leading-5 text-[var(--muted-ink)]">A review captures the exact referenced form.</p></div></div>
          {error ? <p className="mt-6 text-xs leading-5 text-[var(--danger)]">{error}</p> : null}
        </aside>
      </div>
      <footer className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper)] px-4 text-[0.625rem] font-semibold text-[var(--muted-ink)] sm:px-6"><span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${validation.status === "VALID" ? "bg-[var(--moss)]" : "bg-[var(--gold)]"}`} /> {validation.status === "VALID" ? "Schema valid" : `${validation.issues.length} schema issues`}</span><span className="flex items-center gap-1.5"><FileText className="size-3" /> {artifact.key}</span></footer>
      {previewSchema ? <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-28)] backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreviewSchema(null); }}><section role="dialog" aria-modal="true" aria-label="Form preview" className="h-full w-full max-w-[560px] overflow-auto border-l border-[var(--line)] bg-[var(--paper-raised)] px-7 pb-16 pt-7 shadow-[-30px_0_90px_rgba(27,26,23,0.16)] sm:px-10"><header className="mb-10 flex items-start justify-between border-b border-[var(--line-strong)] pb-6"><div><p className="text-[0.625rem] font-bold uppercase tracking-[0.17em] text-[var(--moss)]">Task experience</p><h2 className="font-editorial mt-2 text-4xl font-medium tracking-[-0.05em]">Preview as work.</h2><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">This is how the pinned form will feel inside My work. Test required fields before review.</p></div><button type="button" onClick={() => setPreviewSchema(null)} className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-[var(--wash)]" aria-label="Close preview"><X className="size-4" /></button></header><TaskForm schema={previewSchema} data={{}} />{validation.issues.length ? <details className="mt-10 border-y border-[var(--line)] py-4"><summary className="cursor-pointer text-xs font-bold">{validation.issues.length} saved-schema issue{validation.issues.length === 1 ? "" : "s"}</summary><ul className="mt-3 space-y-2 text-[0.6875rem] text-[var(--danger)]">{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></details> : null}</section></div> : null}
    </div>
  );
}
