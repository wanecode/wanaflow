"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OrganizationLibrary } from "@wanaflow/db";
import { ArrowRight, LoaderCircle, Sparkles, X } from "lucide-react";

import { createAiExperience, loadLibrary } from "@/lib/api-client";

export function AiExperienceCreate() {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<OrganizationLibrary | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => router.replace("/library");

  useEffect(() => {
    let active = true;
    void loadLibrary().then((value) => {
      if (!active) return;
      setLibrary(value);
      setProjectId(value.workspaces.flatMap((workspace) => workspace.projects)[0]?.id ?? "");
      requestAnimationFrame(() => titleRef.current?.focus());
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The workspace could not be opened.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const projects = useMemo(
    () => library?.workspaces.flatMap((workspace) => workspace.projects) ?? [],
    [library],
  );
  const selectedProject = projects.find((project) => project.id === projectId);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const experience = await createAiExperience({
        projectId,
        title: title.trim(),
        description: description.trim(),
      });
      router.replace(`/create/${experience.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conversation could not be started.");
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-28)] px-4 py-8 backdrop-blur-[3px]"
      onMouseDown={(event) => { if (event.currentTarget === event.target && !pending) close(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-with-wana-title"
        aria-describedby="create-with-wana-description"
        className="relative w-full max-w-[690px] overflow-hidden rounded-[calc(var(--radius)+0.45rem)] border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_28px_100px_color-mix(in_oklab,var(--ink)_22%,transparent)]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--signal)] to-transparent opacity-70" />
        <button type="button" onClick={close} disabled={pending} aria-label="Close Create with Wana" className="absolute right-5 top-5 z-10 flex size-9 items-center justify-center rounded-full text-[var(--muted-ink)] transition-colors hover:bg-[var(--wash)] hover:text-[var(--ink)] disabled:opacity-40"><X className="size-4" /></button>

        <div className="px-6 pb-7 pt-8 sm:px-10 sm:pb-9 sm:pt-10">
          <div className="flex items-center gap-2.5 text-[var(--signal)]"><span className="flex size-7 items-center justify-center rounded-full bg-[var(--signal-wash)]"><Sparkles className="size-3.5" /></span><span className="text-[0.625rem] font-bold uppercase tracking-[0.16em]">Create with Wana</span></div>
          <h1 id="create-with-wana-title" className="font-editorial mt-6 max-w-lg text-[clamp(2.35rem,6vw,4rem)] font-medium leading-[0.94] tracking-[-0.055em]">What are we making?</h1>
          <p id="create-with-wana-description" className="mt-4 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">A name and a few plain words are enough. Wana will start the work, then shape it with you in conversation.</p>

          {!library && !error ? <div className="mt-10 flex h-40 items-center justify-center gap-2 border-y border-[var(--line)] text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening a fresh conversation</div> : null}

          {library ? (
            <form onSubmit={submit} className="mt-9">
              <label htmlFor="experience-title" className="sr-only">Title</label>
              <input
                ref={titleRef}
                id="experience-title"
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Give it a name"
                className="h-14 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 text-[1.65rem] font-semibold tracking-[-0.04em] outline-none placeholder:font-normal placeholder:text-[var(--faint-ink)] focus:border-[var(--signal)] focus-visible:outline-none"
              />
              <label htmlFor="experience-description" className="sr-only">Short description</label>
              <textarea
                id="experience-description"
                required
                minLength={12}
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe what should happen, who is involved, and what a good outcome looks like…"
                className="mt-5 min-h-32 w-full resize-none border-0 bg-transparent px-0 py-2 text-base leading-7 outline-none placeholder:text-[var(--faint-ink)] focus-visible:outline-none"
              />

              <div className="mt-3 flex min-h-9 items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
                {projects.length > 1 ? <label className="flex min-w-0 items-center gap-2 text-[0.6875rem] text-[var(--muted-ink)]"><span className="shrink-0">Save in</span><select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="min-w-0 border-0 bg-transparent font-bold text-[var(--ink)] outline-none">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : <p className="truncate text-[0.6875rem] text-[var(--faint-ink)]">Saved in <strong className="font-semibold text-[var(--muted-ink)]">{selectedProject?.name}</strong></p>}
                <span className="font-mono text-[0.58rem] text-[var(--faint-ink)]">{description.length} / 2,000</span>
              </div>

              {error ? <p role="alert" className="mt-4 border-l-2 border-[var(--danger)] pl-3 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
              <div className="mt-7 flex items-center justify-between gap-5">
                <p className="hidden max-w-xs text-[0.625rem] leading-5 text-[var(--faint-ink)] sm:block">You stay in control. Wana drafts; people review and approve.</p>
                <button type="submit" disabled={pending || !projectId || !title.trim() || description.trim().length < 12} className="group ml-auto flex h-11 items-center gap-2.5 rounded-[var(--radius)] bg-[var(--ink)] px-5 text-xs font-bold text-[var(--paper)] shadow-sm transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-35">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Start the conversation <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></button>
              </div>
            </form>
          ) : null}

          {!library && error ? <div className="mt-9 border-y border-[var(--line)] py-8"><p role="alert" className="text-sm text-[var(--danger)]">{error}</p><button type="button" onClick={close} className="mt-5 text-xs font-bold underline underline-offset-4">Return to Studio</button></div> : null}
        </div>
      </section>
    </div>
  );
}
