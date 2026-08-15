import { Buffer } from "node:buffer";

import { BpmnModdle } from "bpmn-moddle";
import {
  listBpmnExternalJobBindings,
  listBpmnDecisionBindings,
  listBpmnMessageCatchBindings,
  listBpmnMessageThrowBindings,
  listBpmnTimerBindings,
  wanaflowModdleDescriptor,
} from "@wanaflow/modeling";

import { RuntimeProfileError } from "./errors";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const ALLOWED_FLOW_ELEMENTS = new Set([
  "bpmn:StartEvent",
  "bpmn:EndEvent",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:BusinessRuleTask",
  "bpmn:IntermediateCatchEvent",
  "bpmn:IntermediateThrowEvent",
  "bpmn:SequenceFlow",
]);

type FlowElement = {
  $type?: string;
  id?: string;
  eventDefinitions?: unknown[];
  sourceRef?: FlowElement;
  targetRef?: FlowElement;
};

type ProcessElement = {
  $type?: string;
  id?: string;
  isExecutable?: boolean;
  flowElements?: FlowElement[];
};

export async function assertRuntimeProfile(source: string) {
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (!sourceBytes || sourceBytes > MAX_SOURCE_BYTES || /<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new RuntimeProfileError(
      "UNSAFE_OR_INVALID_SOURCE",
      "The deployed BPMN source is empty, too large, or contains unsafe XML declarations.",
    );
  }

  let rootElement: { $type?: string; rootElements?: ProcessElement[] };
  try {
    const parsed = await new BpmnModdle({ wanaflow: wanaflowModdleDescriptor } as never).fromXML(source);
    rootElement = parsed.rootElement as typeof rootElement;
  } catch (error) {
    throw new RuntimeProfileError(
      "INVALID_BPMN_XML",
      error instanceof Error ? error.message : "The deployed BPMN source could not be parsed.",
    );
  }

  if (rootElement.$type !== "bpmn:Definitions") {
    throw new RuntimeProfileError("INVALID_BPMN_ROOT", "The deployed source must contain BPMN definitions.");
  }

  const processes = (rootElement.rootElements ?? []).filter(
    (element) => element.$type === "bpmn:Process" && element.isExecutable === true,
  );
  if (processes.length !== 1) {
    throw new RuntimeProfileError(
      "EXECUTABLE_PROCESS_COUNT",
      `Runtime v1 requires exactly one executable process; found ${processes.length}.`,
    );
  }

  const flowElements = processes[0].flowElements ?? [];
  const nodes = flowElements.filter((element) => element.$type !== "bpmn:SequenceFlow");
  const flows = flowElements.filter((element) => element.$type === "bpmn:SequenceFlow");
  let startCount = 0;
  let endCount = 0;
  for (const element of flowElements) {
    if (!element.$type || !ALLOWED_FLOW_ELEMENTS.has(element.$type)) {
      throw new RuntimeProfileError(
        "UNSUPPORTED_RUNTIME_ELEMENT",
        `${element.$type ?? "Unknown element"} is not executable in the first Wanaflow runtime slice.`,
        element.id,
      );
    }
    if (
      element.eventDefinitions?.length &&
      !(
        new Set(["bpmn:IntermediateCatchEvent", "bpmn:IntermediateThrowEvent"]).has(element.$type) &&
        element.eventDefinitions.length === 1 &&
        (element.$type === "bpmn:IntermediateCatchEvent"
          ? new Set(["bpmn:TimerEventDefinition", "bpmn:MessageEventDefinition"])
            .has((element.eventDefinitions[0] as FlowElement).$type ?? "")
          : (element.eventDefinitions[0] as FlowElement).$type === "bpmn:MessageEventDefinition")
      )
    ) {
      throw new RuntimeProfileError(
        "UNSUPPORTED_EVENT_DEFINITION",
        "Runtime v1 supports none start/end events, durable timer/message catches, and durable message throws.",
        element.id,
      );
    }
    if (element.$type === "bpmn:StartEvent") startCount += 1;
    if (element.$type === "bpmn:EndEvent") endCount += 1;
  }
  if (startCount !== 1 || endCount !== 1) {
    throw new RuntimeProfileError(
      "RUNTIME_SHAPE_REQUIRED",
      "Runtime v1 requires exactly one none start event and one none end event.",
    );
  }

  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as FlowElement[]]));
  for (const flow of flows) {
    const sourceId = flow.sourceRef?.id;
    const targetId = flow.targetRef?.id;
    if (!sourceId || !targetId || !incoming.has(sourceId) || !incoming.has(targetId)) {
      throw new RuntimeProfileError(
        "INVALID_SEQUENCE_FLOW",
        "Every runtime-v1 sequence flow must connect two elements in the executable process.",
        flow.id,
      );
    }
    outgoing.get(sourceId)!.push(flow.targetRef!);
    incoming.set(targetId, incoming.get(targetId)! + 1);
  }
  for (const node of nodes) {
    const inputCount = incoming.get(node.id) ?? 0;
    const outputCount = outgoing.get(node.id)?.length ?? 0;
    const valid =
      (node.$type === "bpmn:StartEvent" && inputCount === 0 && outputCount === 1) ||
      (node.$type === "bpmn:EndEvent" && inputCount === 1 && outputCount === 0) ||
      (new Set(["bpmn:UserTask", "bpmn:ServiceTask", "bpmn:BusinessRuleTask", "bpmn:IntermediateCatchEvent", "bpmn:IntermediateThrowEvent"]).has(node.$type ?? "") && inputCount === 1 && outputCount === 1);
    if (!valid) {
      throw new RuntimeProfileError(
        "NON_LINEAR_RUNTIME_FLOW",
        "Runtime v1 requires one unbranched path from the start through user tasks to the end.",
        node.id,
      );
    }
  }
  const start = nodes.find((node) => node.$type === "bpmn:StartEvent")!;
  const visited = new Set<string>();
  let cursor: FlowElement | undefined = start;
  while (cursor?.id && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    cursor = outgoing.get(cursor.id)?.[0];
  }
  if (visited.size !== nodes.length || cursor !== undefined) {
    throw new RuntimeProfileError(
      "NON_LINEAR_RUNTIME_FLOW",
      "Runtime v1 does not allow disconnected elements or cycles.",
    );
  }
  await listBpmnExternalJobBindings(source);
  const decisions = await listBpmnDecisionBindings(source);
  const businessRules = nodes.filter((node) => node.$type === "bpmn:BusinessRuleTask");
  if (decisions.length !== businessRules.length) {
    throw new RuntimeProfileError(
      "DMN_DECISION_BINDING_REQUIRED",
      "Every business rule task in this runtime profile must bind one stable DMN decision key.",
    );
  }
  const timers = await listBpmnTimerBindings(source);
  const messages = await listBpmnMessageCatchBindings(source);
  const messageThrows = await listBpmnMessageThrowBindings(source);
  const catchEvents = nodes.filter((node) => node.$type === "bpmn:IntermediateCatchEvent");
  if (timers.length + messages.length !== catchEvents.length) {
    throw new RuntimeProfileError(
      "DURABLE_CATCH_BINDING_REQUIRED",
      "Every intermediate catch event in this runtime profile must define one supported timer or message subscription.",
    );
  }
  const throwEvents = nodes.filter((node) => node.$type === "bpmn:IntermediateThrowEvent");
  if (messageThrows.length !== throwEvents.length) {
    throw new RuntimeProfileError(
      "DURABLE_MESSAGE_THROW_BINDING_REQUIRED",
      "Every intermediate throw event in this runtime profile must define one durable message delivery.",
    );
  }
}
