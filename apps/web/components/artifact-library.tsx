"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrganizationLibrary, ProjectLibrary, ProjectPackage } from "@wanaflow/db";
import {
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  FileInput,
  Download,
  FileText,
  FolderPlus,
  GitBranch,
  LayoutTemplate,
  LoaderCircle,
  Plus,
  Search,
  Scale,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { createArtifact, createBpmnArtifact, createProject, importProjectPackage, loadLibrary, loadProjectPackage, WanaflowApiError } from "@/lib/api-client";
import { blankBpmnProcess } from "@/lib/new-process";
import { newFormSource } from "@/lib/new-form";
import { blankDmnDecision } from "@/lib/new-decision";
import { processTemplates, processTemplateSource } from "@/lib/process-templates";

type CreationMode = "create" | "template" | "decision" | "form" | "import" | "import-decision" | "import-project" | "project" | null;
type ArtifactFilter = "BPMN_PROCESS" | "DMN_DECISION" | "FORM";

function artifactHref(type: ArtifactFilter, id: string) {
  return type === "FORM" ? `/forms/${id}` : type === "DMN_DECISION" ? `/decisions/${id}` : `/studio/${id}`;
}

function stableKey(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function allProjects(library: OrganizationLibrary | null) {
  return library?.workspaces.flatMap((workspace) => workspace.projects) ?? [];
}

export function ArtifactLibrary() {
  const router = useRouter();
  const [library, setLibrary] = useState<OrganizationLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [artifactFilter, setArtifactFilter] = useState<ArtifactFilter>("BPMN_PROCESS");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [mode, setMode] = useState<CreationMode>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [projectPackage, setProjectPackage] = useState<ProjectPackage | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(processTemplates[0].id);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await loadLibrary();
      setLibrary(next);
      setProjectId((current) => current || allProjects(next)[0]?.id || "");
      if (new URL(window.location.href).searchParams.get("start") === "templates") {
        const template = processTemplates[0];
        setMode("template");
        setTemplateId(template.id);
        setName(template.name);
        setKey(template.suggestedKey);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The library could not be opened.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    loadLibrary()
      .then((next) => {
        if (!active) return;
        setLibrary(next);
        setProjectId((current) => current || allProjects(next)[0]?.id || "");
        if (new URL(window.location.href).searchParams.get("start") === "templates") {
          const template = processTemplates[0];
          setMode("template");
          setTemplateId(template.id);
          setName(template.name);
          setKey(template.suggestedKey);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "The library could not be opened.");
      });
    return () => {
      active = false;
    };
  }, []);

  const projects = useMemo(() => allProjects(library), [library]);
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects
      .map((project) => ({
        ...project,
        artifacts: project.artifacts.filter(
          (artifact) =>
            artifact.type === artifactFilter &&
            (!normalized || artifact.name.toLowerCase().includes(normalized) || artifact.key.toLowerCase().includes(normalized)),
        ),
      }))
      .filter(
        (project) =>
          !normalized ||
          project.name.toLowerCase().includes(normalized) ||
          project.key.toLowerCase().includes(normalized) ||
          project.artifacts.length,
      );
  }, [artifactFilter, projects, query]);

  const canCreateProject = library?.permissions.includes("project:create") ?? false;
  const canCreateArtifact = library?.permissions.includes("artifact:create") ?? false;

  const openMode = (nextMode: Exclude<CreationMode, null>) => {
    setMode(nextMode);
    setNewMenuOpen(false);
    const template = nextMode === "template" ? processTemplates[0] : null;
    setName(template?.name ?? "");
    setKey(template?.suggestedKey ?? "");
    if (template) setTemplateId(template.id);
    setKeyTouched(false);
    setSource(null);
    setFileName(null);
    setProjectPackage(null);
    setFormError(null);
  };

  const close = () => {
    if (pending) return;
    setMode(null);
    setFormError(null);
  };

  const changeName = (value: string) => {
    setName(value);
    if (!keyTouched) setKey(stableKey(value));
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > (mode === "import-project" ? 25 : 2) * 1024 * 1024) {
      setFormError(mode === "import-project" ? "Project packages must be 25 MiB or smaller." : "Model files must be 2 MiB or smaller.");
      return;
    }
    try {
      let xml = await file.text();
      if (mode === "import-project") {
        const parsed = JSON.parse(xml) as ProjectPackage;
        if (parsed.schemaVersion !== 1 || !parsed.project || !Array.isArray(parsed.artifacts)) throw new Error("Unsupported project package");
        setProjectPackage(parsed);
        setSource(null);
        setFileName(file.name);
        setName(parsed.project.name);
        setKey(parsed.project.key);
        setFormError(null);
        return;
      }
      if (mode === "import" && !xml.includes("BPMNDiagram")) {
        const { layoutProcess } = await import("bpmn-auto-layout");
        xml = await layoutProcess(xml);
      }
      setSource(xml);
      setFileName(file.name);
      if (!name) changeName(file.name.replace(/\.bpmn$|\.dmn$|\.xml$/i, "").replace(/[-_]+/g, " "));
      setFormError(null);
    } catch {
      setSource(null);
      setFileName(null);
      setFormError(`That file could not be read as ${mode === "import-decision" ? "a DMN decision" : "a BPMN process"}.`);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      if (!library) return;
      if (mode === "project") {
        const workspace = library.workspaces[0];
        if (!workspace) throw new Error("No workspace is available.");
        const created = await createProject(workspace.id, { name, key });
        await refresh();
        setProjectId(created.id);
        setMode(null);
        return;
      }
      if (mode === "import-project") {
        const workspace = library.workspaces[0];
        if (!workspace || !projectPackage) throw new Error("Choose a Wanaflow project package.");
        const created = await importProjectPackage(workspace.id, {
          ...projectPackage,
          project: { key, name },
        });
        await refresh();
        setProjectId(created.id);
        setMode(null);
        return;
      }

      if (!projectId) throw new Error("Choose a project for this process.");
      if ((mode === "import" || mode === "import-decision") && !source) throw new Error("Choose a model file to import.");
      const artifact = mode === "form"
        ? await createArtifact(projectId, { name, key, source: newFormSource(name), type: "FORM" })
        : mode === "decision" || mode === "import-decision"
          ? await createArtifact(projectId, { name, key, source: source ?? blankDmnDecision(key, name), type: "DMN_DECISION" })
        : await createBpmnArtifact(projectId, {
            name,
            key,
            source: mode === "template" ? processTemplateSource(templateId, key, name) : source ?? blankBpmnProcess(key, name),
          });
      router.push(artifactHref(artifact.type, artifact.id));
    } catch (error) {
      setFormError(
        error instanceof WanaflowApiError && error.code === "RESOURCE_KEY_CONFLICT"
          ? "That key is already used in this project."
          : error instanceof Error
            ? error.message
            : "This item could not be created.",
      );
    } finally {
      setPending(false);
    }
  };

  const exportProject = async (project: ProjectLibrary) => {
    try {
      const projectPackage = await loadProjectPackage(project.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(projectPackage, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.key}.wanaflow.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The project package could not be exported.");
    }
  };

  if (loadError) {
    return (
      <div className="workspace-page flex min-h-full items-center justify-center px-6 py-20 text-center">
        <div className="max-w-md">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-[var(--danger)]">Library unavailable</p>
          <h1 className="font-editorial mt-3 text-4xl font-medium tracking-[-0.05em]">Your worktable stayed closed.</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--muted-ink)]">{loadError}</p>
          <button type="button" onClick={() => void refresh()} className="mt-6 text-xs font-bold text-[var(--signal)]">Try again</button>
        </div>
      </div>
    );
  }

  if (!library) {
    return <div className="flex min-h-full items-center justify-center gap-3 text-xs font-semibold text-[var(--muted-ink)]"><LoaderCircle className="size-4 animate-spin text-[var(--signal)]" /> Opening your process library</div>;
  }

  const artifactCount = projects.reduce((total, project) => total + project.artifacts.length, 0);
  const processCount = projects.reduce((total, project) => total + project.artifacts.filter((artifact) => artifact.type === "BPMN_PROCESS").length, 0);
  const formCount = projects.reduce((total, project) => total + project.artifacts.filter((artifact) => artifact.type === "FORM").length, 0);
  const decisionCount = projects.reduce((total, project) => total + project.artifacts.filter((artifact) => artifact.type === "DMN_DECISION").length, 0);

  return (
    <div className="workspace-page mx-auto min-h-full w-full max-w-[1180px] px-5 pb-28 pt-8 sm:px-8 md:px-10 md:pb-16 md:pt-10">
      <header className="stagger-in flex flex-col gap-6 border-b border-[var(--line)] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">{library.organization.name}</p>
          <h1 className="page-title mt-2">Process library</h1>
          <p className="page-description mt-3">Design, review, and maintain the process assets your team can run.</p>
        </div>
        <div className="relative flex items-center gap-3">
          <span className="hidden text-right text-[0.6875rem] leading-5 text-[var(--muted-ink)] sm:block">{artifactCount} artifact{artifactCount === 1 ? "" : "s"}<br />{library.role.replaceAll("-", " ")}</span>
          {canCreateArtifact ? <Link href="/create" prefetch={false} className="flex h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--signal)] bg-[var(--signal-wash)] px-3.5 text-xs font-semibold text-[var(--signal)]"><Sparkles className="size-3.5" /> Create with AI</Link> : null}
          {(canCreateArtifact || canCreateProject) ? (
            <button type="button" onClick={() => setNewMenuOpen((open) => !open)} className="flex h-9 items-center gap-2 rounded-[var(--radius)] bg-[var(--ink)] px-3.5 text-xs font-semibold text-[var(--paper)]" aria-expanded={newMenuOpen}><Plus className="size-3.5" /> New <ChevronDown className="size-3.5" /></button>
          ) : null}
          {newMenuOpen ? (
            <div className="absolute right-0 top-11 z-30 w-72 rounded-[calc(var(--radius)+0.25rem)] border border-[var(--line)] bg-[var(--paper-raised)] p-1.5 shadow-xl">
              <p className="px-2.5 pb-1 pt-2 text-[0.625rem] font-semibold text-[var(--muted-ink)]">Create</p>
              {canCreateArtifact ? <Link href="/create" prefetch={false} onClick={() => setNewMenuOpen(false)} className="flex w-full items-center gap-3 rounded-[var(--radius)] bg-[var(--signal-wash)] px-2.5 py-2.5 text-left text-[var(--signal)] hover:bg-[var(--wash-strong)]"><Sparkles className="size-4" /><span><span className="block text-xs font-semibold">Create with Wana</span><span className="mt-0.5 block text-[0.625rem] opacity-75">Conversation + live artifacts</span></span></Link> : null}
              {canCreateArtifact ? <button type="button" onClick={() => openMode("create")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2.5 text-left hover:bg-[var(--wash)]"><GitBranch className="size-4 text-[var(--signal)]" /><span><span className="block text-xs font-semibold">Blank process</span><span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">BPMN process</span></span></button> : null}
              {canCreateArtifact ? <button type="button" onClick={() => openMode("template")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2.5 text-left hover:bg-[var(--wash)]"><LayoutTemplate className="size-4 text-[var(--moss)]" /><span><span className="block text-xs font-semibold">Starter story</span><span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">Guided business flow</span></span></button> : null}
              {canCreateArtifact ? <button type="button" onClick={() => openMode("decision")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2.5 text-left hover:bg-[var(--wash)]"><Scale className="size-4 text-[var(--gold)]" /><span><span className="block text-xs font-semibold">Blank decision</span><span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">DMN table</span></span></button> : null}
              {canCreateArtifact ? <button type="button" onClick={() => openMode("form")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2.5 text-left hover:bg-[var(--wash)]"><FileText className="size-4 text-[var(--moss)]" /><span><span className="block text-xs font-semibold">New form</span><span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">Reusable task form</span></span></button> : null}
              <details className="group mt-1 border-t border-[var(--line)] pt-1">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-[var(--radius)] px-2.5 py-2 text-[0.6875rem] font-semibold text-[var(--muted-ink)] hover:bg-[var(--wash)]"><span>Import or manage</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary>
                <div className="pb-1">
                  {canCreateArtifact ? <button type="button" onClick={() => openMode("import")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs hover:bg-[var(--wash)]"><FileInput className="size-3.5" /> Import BPMN</button> : null}
                  {canCreateArtifact ? <button type="button" onClick={() => openMode("import-decision")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs hover:bg-[var(--wash)]"><FileInput className="size-3.5" /> Import DMN</button> : null}
                  {canCreateProject ? <button type="button" onClick={() => openMode("import-project")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs hover:bg-[var(--wash)]"><Upload className="size-3.5" /> Import project package</button> : null}
                  {canCreateProject ? <button type="button" onClick={() => openMode("project")} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2.5 py-2 text-left text-xs hover:bg-[var(--wash)]"><FolderPlus className="size-3.5" /> New project</button> : null}
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 border-b border-[var(--line)] py-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Artifact type" className="flex items-center gap-5 text-xs font-semibold">
          <button type="button" onClick={() => setArtifactFilter("BPMN_PROCESS")} className={`pb-1 ${artifactFilter === "BPMN_PROCESS" ? "border-b-2 border-[var(--signal)] text-[var(--ink)]" : "text-[var(--faint-ink)]"}`}>Processes <span className="ml-1 text-[0.6rem]">{processCount}</span></button>
          <button type="button" onClick={() => setArtifactFilter("DMN_DECISION")} className={`pb-1 ${artifactFilter === "DMN_DECISION" ? "border-b-2 border-[var(--signal)] text-[var(--ink)]" : "text-[var(--faint-ink)]"}`}>Decisions <span className="ml-1 text-[0.6rem]">{decisionCount}</span></button>
          <button type="button" onClick={() => setArtifactFilter("FORM")} className={`pb-1 ${artifactFilter === "FORM" ? "border-b-2 border-[var(--signal)] text-[var(--ink)]" : "text-[var(--faint-ink)]"}`}>Forms <span className="ml-1 text-[0.6rem]">{formCount}</span></button>
        </nav>
        <label className="flex h-9 items-center gap-2 border-b border-[var(--line)] text-[var(--muted-ink)] focus-within:border-[var(--ink)]"><Search className="size-3.5" /><span className="sr-only">Search artifacts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={artifactFilter === "FORM" ? "Find a form" : artifactFilter === "DMN_DECISION" ? "Find a decision" : "Find a process"} className="w-48 bg-transparent text-xs font-semibold outline-none placeholder:text-[var(--faint-ink)]" /></label>
      </div>

      <div>
        {filteredProjects.length ? filteredProjects.map((project) => (
          <section key={project.id} className="border-b border-[var(--line-strong)] py-6" aria-labelledby={`project-${project.id}`}>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-3"><h2 id={`project-${project.id}`} className="text-xs font-semibold">{project.name}</h2><code className="hidden text-[0.6rem] text-[var(--faint-ink)] sm:inline">{project.key}</code></div>
              <span className="flex items-center gap-3"><button type="button" onClick={() => void exportProject(project)} className="flex items-center gap-1 text-[0.625rem] font-bold text-[var(--muted-ink)] hover:text-[var(--signal)]"><Download className="size-3" /> Export</button><span className="text-[0.625rem] font-semibold text-[var(--faint-ink)]">{project.artifacts.length} {artifactFilter === "FORM" ? "form" : artifactFilter === "DMN_DECISION" ? "decision" : "process"}{project.artifacts.length === 1 ? "" : artifactFilter === "BPMN_PROCESS" ? "es" : "s"}</span></span>
            </div>
            {project.artifacts.length ? (
              <div className="divide-y divide-[var(--line)]">
                {project.artifacts.map((artifact) => {
                  const errors = artifact.revision.validation.issues.filter((issue) => issue.severity === "ERROR").length;
                  return (
                    <Link key={artifact.id} href={artifactHref(artifact.type, artifact.id)} prefetch={false} className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-3.5 transition-colors hover:bg-[var(--wash-glass-55)] sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(120px,0.5fr)_auto]">
                      <span className={`flex size-8 items-center justify-center rounded-[var(--radius)] ${artifact.type === "FORM" ? "bg-[var(--moss-wash)] text-[var(--moss)]" : artifact.type === "DMN_DECISION" ? "bg-[var(--gold-wash)] text-[var(--gold)]" : "bg-[var(--signal-wash)] text-[var(--signal)]"}`}>{artifact.type === "FORM" ? <FileText className="size-3.5" /> : artifact.type === "DMN_DECISION" ? <Scale className="size-3.5" /> : <GitBranch className="size-3.5" />}</span>
                      <span className="min-w-0"><span className="block truncate text-xs font-semibold">{artifact.name}</span><span className="mt-1 block truncate font-mono text-[0.6rem] text-[var(--faint-ink)]">{artifact.key}</span></span>
                      <span className="hidden min-w-0 sm:block"><span className={`flex items-center gap-1.5 text-[0.6875rem] font-semibold ${errors ? "text-[var(--gold)]" : "text-[var(--moss)]"}`}>{errors ? <Braces className="size-3" /> : <Check className="size-3" />}{errors ? `${errors} validation issue${errors === 1 ? "" : "s"}` : "Structurally valid"}</span><span className="mt-1 block text-[0.625rem] text-[var(--faint-ink)]">Revision {artifact.revision.number}</span></span>
                      <span className="flex items-center gap-3"><span className="hidden text-right text-[0.625rem] leading-5 text-[var(--faint-ink)] md:block">{artifact.revision.createdBy.displayName}<br />{relativeTime(artifact.updatedAt)}</span><ArrowRight className="size-4 text-[var(--faint-ink)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ink)]" /></span>
                    </Link>
                  );
                })}
              </div>
            ) : <button type="button" onClick={() => { setProjectId(project.id); openMode(artifactFilter === "FORM" ? "form" : artifactFilter === "DMN_DECISION" ? "decision" : "create"); }} className="flex w-full items-center gap-2 py-5 text-left text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--signal)]"><Plus className="size-3.5" /> {artifactFilter === "FORM" ? "Create this project’s first form" : artifactFilter === "DMN_DECISION" ? "Shape this project’s first decision" : "Start this project’s first process"}</button>}
          </section>
        )) : (
          <div className="py-24 text-center"><p className="font-editorial text-4xl text-[var(--faint-ink)]">Nothing matched.</p><button type="button" onClick={() => setQuery("")} className="mt-4 text-xs font-bold text-[var(--signal)]">Clear the search</button></div>
        )}
      </div>

      {mode ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-28)] backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="creation-title" className="flex h-full w-full max-w-[520px] flex-col border-l border-[var(--line)] bg-[var(--paper-raised)] shadow-[-30px_0_90px_rgba(27,26,23,0.16)]">
            <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-5 sm:px-8"><div><p className="section-label">{mode === "project" ? "New boundary" : mode === "import-project" ? "Portable project" : mode === "import" || mode === "import-decision" ? "Portable source" : mode === "template" ? "Guided beginning" : mode === "form" ? "Reusable interaction" : mode === "decision" ? "Business rule" : "New model"}</p><h2 id="creation-title" className="mt-1 text-lg font-semibold">{mode === "project" ? "Create a project" : mode === "import-project" ? "Import a project" : mode === "import" ? "Import BPMN" : mode === "import-decision" ? "Import DMN" : mode === "template" ? "Choose a starter story" : mode === "form" ? "Begin a form" : mode === "decision" ? "Begin a decision" : "Begin a process"}</h2></div><button type="button" onClick={close} className="flex size-9 items-center justify-center rounded-[var(--radius)] hover:bg-[var(--wash)]" aria-label="Close"><X className="size-4" /></button></header>
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-7 overflow-auto px-6 py-8 sm:px-8">
                {mode === "import" || mode === "import-decision" || mode === "import-project" ? (
                  <label className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[calc(var(--radius)+0.25rem)] border border-dashed px-6 text-center transition-colors ${(source || projectPackage) ? "border-[var(--moss)] bg-[var(--moss-wash)]" : "border-[var(--line-strong)] hover:border-[var(--signal)] hover:bg-[var(--signal-wash)]"}`}><input type="file" accept={mode === "import-project" ? ".json,application/json" : mode === "import-decision" ? ".dmn,.xml,application/xml,text/xml" : ".bpmn,.xml,application/xml,text/xml"} className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} /><Upload className={`size-5 ${(source || projectPackage) ? "text-[var(--moss)]" : "text-[var(--signal)]"}`} /><span className="mt-3 text-xs font-semibold">{fileName ?? `Choose a ${mode === "import-project" ? "Wanaflow project package" : mode === "import-decision" ? "DMN" : "BPMN"} file`}</span><span className="mt-1 text-[0.625rem] text-[var(--muted-ink)]">{mode === "import-project" ? "BPMN, DMN, and forms · integrity checked" : "Portable XML · up to 2 MiB"}</span></label>
                ) : null}
                {mode === "template" ? <fieldset><legend className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-[var(--faint-ink)]">A familiar shape</legend><div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{processTemplates.map((template, index) => { const active = template.id === templateId; return <button key={template.id} type="button" onClick={() => { setTemplateId(template.id); setName(template.name); if (!keyTouched) setKey(template.suggestedKey); }} className={`grid w-full grid-cols-[2rem_1fr_auto] gap-3 py-4 text-left ${active ? "text-[var(--ink)]" : "text-[var(--muted-ink)]"}`}><span className={`font-editorial text-xl ${active ? "text-[var(--signal)]" : "text-[var(--faint-ink)]"}`}>0{index + 1}</span><span><span className="block text-xs font-bold">{template.name}</span><span className="mt-1 block text-[0.625rem] leading-5">{template.description}</span><span className="mt-2 block text-[0.58rem] font-bold text-[var(--moss)]">{template.promise}</span></span><span className={`mt-1 size-4 rounded-full border ${active ? "border-[var(--signal)] bg-[var(--signal)] shadow-[inset_0_0_0_3px_var(--paper-raised)]" : "border-[var(--line-strong)]"}`} /></button>; })}</div><p className="mt-3 text-[0.625rem] leading-5 text-[var(--muted-ink)]">Every starter stays inside Wanaflow’s proven linear runtime profile. Rename, reshape, and attach forms after it opens.</p></fieldset> : null}
                <div><label htmlFor="creation-name" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Name</label><input id="creation-name" required maxLength={mode === "project" ? 120 : 160} autoFocus={mode !== "import" && mode !== "import-decision"} value={name} onChange={(event) => changeName(event.target.value)} placeholder={mode === "project" ? "Customer operations" : mode === "form" ? "Expense request" : mode === "decision" || mode === "import-decision" ? "Invoice routing" : "Invoice approval"} className="h-12 w-full border-0 border-b border-[var(--line-strong)] bg-transparent px-0 text-lg font-semibold tracking-[-0.025em] outline-none focus:border-[var(--signal)]" /></div>
                <div><label htmlFor="creation-key" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Stable key</label><input id="creation-key" required minLength={2} maxLength={63} pattern="[a-z](?:[a-z0-9]|-)+" value={key} onChange={(event) => { setKeyTouched(true); setKey(event.target.value); }} placeholder="invoice-approval" className="h-11 w-full border-0 border-b border-[var(--line)] bg-transparent px-0 font-mono text-xs outline-none focus:border-[var(--signal)]" /><p className="mt-2 text-[0.625rem] leading-5 text-[var(--faint-ink)]">Used by APIs and deployments. Lowercase letters, numbers, and hyphens.</p></div>
                {mode !== "project" && projects.length > 1 ? <div><label htmlFor="creation-project" className="mb-2 block text-[0.625rem] font-bold uppercase tracking-[0.14em] text-[var(--faint-ink)]">Project</label><select id="creation-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-11 w-full border-0 border-b border-[var(--line)] bg-transparent text-sm font-semibold outline-none focus:border-[var(--signal)]">{projects.map((project: ProjectLibrary) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div> : null}
                {formError ? <p role="alert" className="text-xs font-semibold leading-5 text-[var(--danger)]">{formError}</p> : null}
              </div>
              <footer className="flex items-center justify-between border-t border-[var(--line)] px-6 py-5 sm:px-8"><button type="button" onClick={close} className="text-xs font-bold text-[var(--muted-ink)] hover:text-[var(--ink)]">Cancel</button><button type="submit" disabled={pending || !name || !key || ((mode === "import" || mode === "import-decision") && !source) || (mode === "import-project" && !projectPackage)} className="flex h-10 items-center gap-2 rounded-[var(--radius)] bg-[var(--ink)] px-5 text-xs font-bold text-[var(--paper)] disabled:opacity-40">{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{mode === "project" ? "Create project" : mode === "import" || mode === "import-decision" || mode === "import-project" ? "Import" : mode === "template" ? "Use this story" : mode === "form" ? "Create form" : mode === "decision" ? "Create decision" : "Create and open"}<ArrowRight className="size-3.5" /></button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
