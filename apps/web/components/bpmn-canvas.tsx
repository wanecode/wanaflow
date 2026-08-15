"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ArtifactEditorPresence } from "@wanaflow/db";
import { Maximize2, Minus, MousePointer2, Plus } from "lucide-react";
import { cn } from "@wanaflow/ui";
import { wanaflowModdleDescriptor } from "@wanaflow/modeling";

type CanvasApi = {
  addMarker: (elementId: string, marker: string) => void;
  removeMarker: (elementId: string, marker: string) => void;
  scroll: (delta: { dx: number; dy: number }) => void;
  scrollToElement: (element: BpmnElement) => void;
  zoom: (value?: number | "fit-viewport") => number;
};

type EventBusApi = {
  on: (event: string, callback: (payload: SelectionEvent | ElementEvent) => void) => void;
};

type SelectionEvent = {
  newSelection?: Array<{
    id: string;
    type?: string;
    businessObject?: { name?: string };
  }>;
};

type BpmnElement = {
  id: string;
  type?: string;
  businessObject?: {
    name?: string;
    formKey?: string;
    inputMapping?: string;
    outputMapping?: string;
    assigneeEmail?: string;
    candidateGroupKey?: string;
    jobType?: string;
    jobInputMapping?: string;
    jobOutputMapping?: string;
    jobHeaders?: string;
    jobLockDuration?: string;
    jobMaxAttempts?: number;
    jobRetryBackoff?: string;
    correlationKey?: string;
    messagePayloadMapping?: string;
    decisionKey?: string;
    decisionInputMapping?: string;
    decisionOutputMapping?: string;
    $parent?: {
      $parent?: { rootElements?: unknown[] };
    };
    eventDefinitions?: Array<{
      $type?: string;
      timeDuration?: { body?: string };
      timeDate?: { body?: string };
      messageRef?: { id?: string; name?: string };
    }>;
  };
};

type ElementEvent = {
  element?: BpmnElement;
};

function selectedElement(element?: BpmnElement): SelectedElement | null {
  const timerDefinition = element?.businessObject?.eventDefinitions?.find(
    (definition) => definition.$type === "bpmn:TimerEventDefinition",
  );
  const messageDefinition = element?.businessObject?.eventDefinitions?.find(
    (definition) => definition.$type === "bpmn:MessageEventDefinition",
  );
  return element
    ? {
        id: element.id,
        name: element.businessObject?.name || element.id,
        type: element.type?.replace("bpmn:", "") || "Element",
        catchKind: timerDefinition
          ? "TIMER"
          : messageDefinition
            ? "MESSAGE"
            : null,
        assignmentBinding: element.businessObject?.assigneeEmail
          ? { kind: "PERSON", email: element.businessObject.assigneeEmail }
          : element.businessObject?.candidateGroupKey
            ? { kind: "GROUP", groupKey: element.businessObject.candidateGroupKey }
            : { kind: "STARTER" },
        formBinding: element.businessObject?.formKey
          ? {
              formKey: element.businessObject.formKey,
              inputMapping: parseMapping(element.businessObject.inputMapping),
              outputMapping: parseMapping(element.businessObject.outputMapping),
            }
          : null,
        jobBinding: element.businessObject?.jobType
          ? {
              jobType: element.businessObject.jobType,
              inputMapping: parseMapping(element.businessObject.jobInputMapping),
              outputMapping: parseMapping(element.businessObject.jobOutputMapping),
              headers: parseHeaders(element.businessObject.jobHeaders),
              lockDuration: element.businessObject.jobLockDuration || "PT30S",
              maxAttempts: element.businessObject.jobMaxAttempts || 3,
              retryBackoff: element.businessObject.jobRetryBackoff || "PT10S",
            }
          : null,
        decisionBinding: element.businessObject?.decisionKey
          ? {
              decisionKey: element.businessObject.decisionKey,
              inputMapping: parseMapping(element.businessObject.decisionInputMapping),
              outputMapping: parseMapping(element.businessObject.decisionOutputMapping),
            }
          : null,
        timerBinding: timerDefinition?.timeDate?.body
          ? { timerType: "DATE", expression: timerDefinition.timeDate.body }
          : timerDefinition?.timeDuration?.body
            ? { timerType: "DURATION", expression: timerDefinition.timeDuration.body }
            : null,
        messageBinding: element.type === "bpmn:IntermediateCatchEvent" && messageDefinition?.messageRef?.name && element.businessObject?.correlationKey
          ? {
              messageName: messageDefinition.messageRef.name,
              correlationKeyVariable: element.businessObject.correlationKey,
            }
          : null,
        messageThrowBinding: element.type === "bpmn:IntermediateThrowEvent" && messageDefinition?.messageRef?.name && element.businessObject?.correlationKey
          ? {
              messageName: messageDefinition.messageRef.name,
              correlationKeyVariable: element.businessObject.correlationKey,
              payloadMapping: parseMapping(element.businessObject.messagePayloadMapping),
            }
          : null,
      }
    : null;
}

function parseHeaders(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as ExternalJobBinding["headers"]
      : {};
  } catch {
    return {};
  }
}

function parseMapping(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

type BpmnInstance = {
  destroy: () => void;
  get: (service: string) => unknown;
  importXML: (xml: string) => Promise<{ warnings: Array<unknown> }>;
  on: (event: string, callback: () => void) => void;
  saveXML: (options: { format: boolean }) => Promise<{ xml?: string }>;
};

type BpmnConstructor = new (options: {
  container: HTMLElement;
  moddleExtensions?: Record<string, unknown>;
}) => BpmnInstance;

type ElementRegistryApi = { get: (elementId: string) => BpmnElement | undefined };
type SelectionApi = { select: (element: BpmnElement) => void };
type ModelingApi = {
  updateProperties: (element: BpmnElement, properties: Record<string, unknown>) => void;
  updateModdleProperties: (element: BpmnElement, moddleElement: unknown, properties: Record<string, unknown>) => void;
};
type ModdleApi = { create: (type: string, properties?: Record<string, unknown>) => unknown };

export type SelectedElement = {
  id: string;
  name: string;
  type: string;
  catchKind?: "TIMER" | "MESSAGE" | null;
  formBinding?: UserTaskFormBinding | null;
  assignmentBinding?: UserTaskAssignmentBinding;
  jobBinding?: ExternalJobBinding | null;
  timerBinding?: TimerBinding | null;
  messageBinding?: MessageBinding | null;
  messageThrowBinding?: MessageThrowBinding | null;
  decisionBinding?: DecisionBinding | null;
};

export type UserTaskFormBinding = {
  formKey: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
};

export type UserTaskAssignmentBinding =
  | { kind: "STARTER" }
  | { kind: "PERSON"; email: string }
  | { kind: "GROUP"; groupKey: string };

export type ExternalJobBinding = {
  jobType: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
  headers: Record<string, null | boolean | number | string>;
  lockDuration: string;
  maxAttempts: number;
  retryBackoff: string;
};

export type TimerBinding = {
  timerType: "DURATION" | "DATE";
  expression: string;
};

export type MessageBinding = {
  messageName: string;
  correlationKeyVariable: string;
};

export type MessageThrowBinding = MessageBinding & {
  payloadMapping: Record<string, string>;
};

export type DecisionBinding = {
  decisionKey: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
};

export type BpmnCanvasHandle = {
  saveXml: () => Promise<string>;
  selectElement: (elementId: string) => void;
  setUserTaskFormBinding: (elementId: string, binding: UserTaskFormBinding | null) => void;
  setUserTaskAssignmentBinding: (elementId: string, binding: UserTaskAssignmentBinding) => void;
  setExternalJobBinding: (elementId: string, binding: ExternalJobBinding | null) => void;
  setTimerBinding: (elementId: string, binding: TimerBinding) => void;
  setMessageBinding: (elementId: string, binding: MessageBinding) => void;
  setMessageThrowBinding: (elementId: string, binding: MessageThrowBinding) => void;
  setDecisionBinding: (elementId: string, binding: DecisionBinding | null) => void;
};

export const BpmnCanvas = forwardRef<BpmnCanvasHandle, {
  xml: string;
  mode?: "edit" | "view";
  highlightElementId?: string;
  highlightElementIds?: string[];
  onSelectionChange?: (element: SelectedElement | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  collaborators?: ArtifactEditorPresence[];
  onCursorChange?: (cursor: { x: number; y: number } | null) => void;
  className?: string;
}>(function BpmnCanvas({
  xml,
  mode = "edit",
  highlightElementId,
  highlightElementIds,
  onSelectionChange,
  onDirtyChange,
  collaborators = [],
  onCursorChange,
  className,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<BpmnInstance | null>(null);
  const remoteMarkerIdsRef = useRef<string[]>([]);
  const lastCursorSentAtRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useImperativeHandle(ref, () => ({
    async saveXml() {
      const result = await instanceRef.current?.saveXML({ format: true });
      if (!result?.xml) throw new Error("The BPMN modeler did not return XML.");
      return result.xml;
    },
    selectElement(elementId) {
      const instance = instanceRef.current;
      if (!instance) return;
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element) return;
      (instance.get("selection") as SelectionApi).select(element);
      (instance.get("canvas") as CanvasApi).scrollToElement(element);
    },
    setUserTaskFormBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:UserTask") throw new Error("Select a user task before attaching a form.");
      (instance.get("modeling") as ModelingApi).updateProperties(element, {
        formKey: binding?.formKey || undefined,
        inputMapping: binding ? JSON.stringify(binding.inputMapping) : undefined,
        outputMapping: binding ? JSON.stringify(binding.outputMapping) : undefined,
      });
    },
    setUserTaskAssignmentBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:UserTask") throw new Error("Select a user task before choosing its owner.");
      (instance.get("modeling") as ModelingApi).updateProperties(element, {
        assigneeEmail: binding.kind === "PERSON" ? binding.email : undefined,
        candidateGroupKey: binding.kind === "GROUP" ? binding.groupKey : undefined,
      });
    },
    setExternalJobBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:ServiceTask") throw new Error("Select a service task before configuring a worker job.");
      (instance.get("modeling") as ModelingApi).updateProperties(element, {
        jobType: binding?.jobType || undefined,
        jobInputMapping: binding ? JSON.stringify(binding.inputMapping) : undefined,
        jobOutputMapping: binding ? JSON.stringify(binding.outputMapping) : undefined,
        jobHeaders: binding ? JSON.stringify(binding.headers) : undefined,
        jobLockDuration: binding?.lockDuration || undefined,
        jobMaxAttempts: binding?.maxAttempts || undefined,
        jobRetryBackoff: binding?.retryBackoff || undefined,
      });
    },
    setDecisionBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:BusinessRuleTask") throw new Error("Select a business rule task before attaching a decision.");
      (instance.get("modeling") as ModelingApi).updateProperties(element, {
        decisionKey: binding?.decisionKey || undefined,
        decisionInputMapping: binding ? JSON.stringify(binding.inputMapping) : undefined,
        decisionOutputMapping: binding ? JSON.stringify(binding.outputMapping) : undefined,
      });
    },
    setTimerBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:IntermediateCatchEvent") {
        throw new Error("Select an intermediate catch event before configuring a timer.");
      }
      const moddle = instance.get("moddle") as ModdleApi;
      const modeling = instance.get("modeling") as ModelingApi;
      const businessObject = element.businessObject!;
      const timerDefinition = businessObject.eventDefinitions?.find(
        (definition) => definition.$type === "bpmn:TimerEventDefinition",
      ) ?? moddle.create("bpmn:TimerEventDefinition") as NonNullable<typeof businessObject.eventDefinitions>[number];
      const expression = moddle.create("bpmn:FormalExpression", { body: binding.expression.trim() });
      if (!businessObject.eventDefinitions?.includes(timerDefinition)) {
        modeling.updateModdleProperties(element, businessObject, { eventDefinitions: [timerDefinition] });
      }
      modeling.updateModdleProperties(element, businessObject, { correlationKey: undefined });
      modeling.updateModdleProperties(element, timerDefinition, {
        timeDuration: binding.timerType === "DURATION" ? expression : undefined,
        timeDate: binding.timerType === "DATE" ? expression : undefined,
        timeCycle: undefined,
      });
    },
    setMessageBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:IntermediateCatchEvent") {
        throw new Error("Select an intermediate message catch before configuring its contract.");
      }
      const moddle = instance.get("moddle") as ModdleApi;
      const modeling = instance.get("modeling") as ModelingApi;
      const businessObject = element.businessObject!;
      const definitions = businessObject.$parent?.$parent;
      if (!definitions) throw new Error("The BPMN definitions could not be resolved.");
      const messageDefinition = businessObject.eventDefinitions?.find(
        (definition) => definition.$type === "bpmn:MessageEventDefinition",
      ) ?? moddle.create("bpmn:MessageEventDefinition") as NonNullable<typeof businessObject.eventDefinitions>[number];
      const message = messageDefinition.messageRef ?? moddle.create("bpmn:Message", {
        id: `Message_${element.id}`,
      }) as { id?: string; name?: string };
      if (!messageDefinition.messageRef) {
        modeling.updateModdleProperties(element, definitions, {
          rootElements: [...(definitions.rootElements ?? []), message],
        });
      }
      modeling.updateModdleProperties(element, message, { name: binding.messageName.trim() });
      modeling.updateModdleProperties(element, messageDefinition, { messageRef: message });
      modeling.updateModdleProperties(element, businessObject, {
        eventDefinitions: [messageDefinition],
        correlationKey: binding.correlationKeyVariable.trim(),
      });
    },
    setMessageThrowBinding(elementId, binding) {
      const instance = instanceRef.current;
      if (!instance) throw new Error("The BPMN modeler is not ready.");
      const element = (instance.get("elementRegistry") as ElementRegistryApi).get(elementId);
      if (!element || element.type !== "bpmn:IntermediateThrowEvent") {
        throw new Error("Select an intermediate message throw before configuring its contract.");
      }
      const moddle = instance.get("moddle") as ModdleApi;
      const modeling = instance.get("modeling") as ModelingApi;
      const businessObject = element.businessObject!;
      const definitions = businessObject.$parent?.$parent;
      if (!definitions) throw new Error("The BPMN definitions could not be resolved.");
      const messageDefinition = businessObject.eventDefinitions?.find(
        (definition) => definition.$type === "bpmn:MessageEventDefinition",
      ) ?? moddle.create("bpmn:MessageEventDefinition") as NonNullable<typeof businessObject.eventDefinitions>[number];
      const message = messageDefinition.messageRef ?? moddle.create("bpmn:Message", {
        id: `Message_${element.id}`,
      }) as { id?: string; name?: string };
      if (!messageDefinition.messageRef) {
        modeling.updateModdleProperties(element, definitions, {
          rootElements: [...(definitions.rootElements ?? []), message],
        });
      }
      modeling.updateModdleProperties(element, message, { name: binding.messageName.trim() });
      modeling.updateModdleProperties(element, messageDefinition, { messageRef: message });
      modeling.updateModdleProperties(element, businessObject, {
        eventDefinitions: [messageDefinition],
        correlationKey: binding.correlationKeyVariable.trim(),
        messagePayloadMapping: Object.keys(binding.payloadMapping).length
          ? JSON.stringify(binding.payloadMapping)
          : undefined,
      });
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const mount = async () => {
      try {
        const bpmnModule =
          mode === "edit"
            ? await import("bpmn-js/lib/Modeler")
            : await import("bpmn-js/lib/NavigatedViewer");
        if (cancelled) return;

        const Constructor = bpmnModule.default as unknown as BpmnConstructor;
        const instance = new Constructor({
          container,
          moddleExtensions: { wanaflow: wanaflowModdleDescriptor },
        });
        instanceRef.current = instance;
        let displayXml = xml;
        if (!displayXml.includes("BPMNDiagram")) {
          const { layoutProcess } = await import("bpmn-auto-layout");
          displayXml = await layoutProcess(displayXml);
        }
        const result = await instance.importXML(displayXml);
        if (cancelled) return;

        const canvas = instance.get("canvas") as CanvasApi;
        canvas.zoom("fit-viewport");
        if (mode === "edit") canvas.scroll({ dx: 72, dy: 0 });
        for (const elementId of new Set([
          ...(highlightElementIds ?? []),
          ...(highlightElementId ? [highlightElementId] : []),
        ])) {
          if ((instance.get("elementRegistry") as ElementRegistryApi).get(elementId)) {
            canvas.addMarker(elementId, "wanaflow-changed");
          }
        }

        if (onSelectionChange) {
          const eventBus = instance.get("eventBus") as EventBusApi;
          if (mode === "edit") {
            eventBus.on("selection.changed", (event) => {
              onSelectionChange(selectedElement((event as SelectionEvent).newSelection?.[0]));
            });
          } else {
            eventBus.on("element.click", (event) => {
              onSelectionChange(selectedElement((event as ElementEvent).element));
            });
          }
        }
        if (mode === "edit" && onDirtyChange) {
          instance.on("commandStack.changed", () => onDirtyChange(true));
        }

        if (result.warnings.length) {
          console.info("BPMN import warnings", result.warnings);
        }
        setStatus("ready");
      } catch (error) {
        console.error("Unable to load BPMN canvas", error);
        setStatus("error");
      }
    };

    void mount();
    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [highlightElementId, highlightElementIds, mode, onDirtyChange, onSelectionChange, xml]);

  useEffect(() => {
    if (status !== "ready" || !instanceRef.current) return;
    const canvas = instanceRef.current.get("canvas") as CanvasApi;
    for (const elementId of remoteMarkerIdsRef.current) {
      canvas.removeMarker(elementId, "wanaflow-collaborator-selected");
    }
    const registry = instanceRef.current.get("elementRegistry") as ElementRegistryApi;
    const nextIds = [...new Set(collaborators
      .filter((entry) => entry.isCurrentRevision)
      .map((entry) => entry.selectedElement?.id)
      .filter((elementId): elementId is string => Boolean(elementId && registry.get(elementId))))];
    for (const elementId of nextIds) canvas.addMarker(elementId, "wanaflow-collaborator-selected");
    remoteMarkerIdsRef.current = nextIds;
  }, [collaborators, status]);

  const changeZoom = (delta: number) => {
    const canvas = instanceRef.current?.get("canvas") as CanvasApi | undefined;
    if (!canvas) return;
    const current = canvas.zoom();
    canvas.zoom(Math.min(2.2, Math.max(0.35, current + delta)));
  };

  const fit = () => {
    const canvas = instanceRef.current?.get("canvas") as CanvasApi | undefined;
    canvas?.zoom("fit-viewport");
  };

  const trackCursor = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "edit" || !onCursorChange) return;
    const now = Date.now();
    if (now - lastCursorSentAtRef.current < 120) return;
    lastCursorSentAtRef.current = now;
    const bounds = event.currentTarget.getBoundingClientRect();
    onCursorChange({
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    });
  };

  return (
    <div
      className={cn(
        "bpmn-surface relative size-full min-h-[420px] overflow-hidden bg-[var(--paper-raised)]",
        mode === "view" && "bpmn-readonly",
        className,
      )}
      onPointerMove={trackCursor}
      onPointerLeave={() => onCursorChange?.(null)}
    >
      <div ref={containerRef} className="size-full" aria-label="Employee onboarding BPMN diagram" />

      {collaborators.filter((entry) => entry.isCurrentRevision && entry.cursor).map((entry, index) => (
        <div
          key={entry.clientId}
          data-collaborator-cursor={entry.principal.displayName}
          className="pointer-events-none absolute z-20 flex items-start gap-1 transition-[left,top] duration-200 ease-out"
          style={{ left: `${entry.cursor!.x * 100}%`, top: `${entry.cursor!.y * 100}%` }}
          aria-hidden="true"
        >
          <MousePointer2 className={`size-4 drop-shadow-sm ${index % 2 ? "fill-[#b86b45] text-[#b86b45]" : "fill-[#51715a] text-[#51715a]"}`} />
          <span className={`rounded-[var(--radius)] px-1.5 py-0.5 text-[0.55rem] font-semibold text-white shadow-sm ${index % 2 ? "bg-[#b86b45]" : "bg-[#51715a]"}`}>
            {entry.principal.displayName.split(/\s+/)[0]}
          </span>
        </div>
      ))}

      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-raised)]">
          <div className="flex items-center gap-3 text-xs font-semibold text-[var(--muted-ink)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--signal)]" />
            Preparing the process canvas
          </div>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-raised)] px-6 text-center text-sm text-[var(--danger)]">
          The process diagram could not be loaded.
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-full border border-[var(--line)] bg-[var(--raised-glass-90)] p-1 shadow-[0_8px_30px_rgba(27,26,23,0.08)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => changeZoom(-0.12)}
            className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"
            aria-label="Zoom out"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={fit}
            className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"
            aria-label="Fit diagram to viewport"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(0.12)}
            className="flex size-8 items-center justify-center rounded-full text-[var(--muted-ink)] hover:bg-[var(--wash)] hover:text-[var(--ink)]"
            aria-label="Zoom in"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
});
