import { BpmnModdle } from "bpmn-moddle";

import {
  BpmnSourceError,
  type BpmnElementReference,
  type BpmnValidationResult,
  type DecisionBinding,
  type ExternalJobBinding,
  type MessageCatchBinding,
  type MessageThrowBinding,
  type TimerBinding,
  type UserTaskAssignmentBinding,
  type ValidationIssue,
} from "./types";
import { wanaflowModdleDescriptor } from "./wanaflow-moddle";
import type { FormBinding } from "./types";

const MAX_BPMN_SOURCE_BYTES = 2 * 1024 * 1024;

type ModdleElement = {
  $type?: string;
  id?: string;
  isExecutable?: boolean;
  cancelActivity?: boolean;
  flowElements?: ModdleElement[];
  eventDefinitions?: ModdleElement[];
  messageRef?: ModdleElement;
  name?: string;
  formKey?: string;
  inputMapping?: string;
  outputMapping?: string;
  assigneeEmail?: string;
  candidateGroupKey?: string;
  decisionKey?: string;
  decisionInputMapping?: string;
  decisionOutputMapping?: string;
  jobType?: string;
  jobInputMapping?: string;
  jobOutputMapping?: string;
  jobHeaders?: string;
  jobLockDuration?: string;
  jobMaxAttempts?: number;
  jobRetryBackoff?: string;
  correlationKey?: string;
  messagePayloadMapping?: string;
  timeDuration?: { body?: string };
  timeDate?: { body?: string };
  timeCycle?: { body?: string };
};

type Definitions = ModdleElement & {
  rootElements?: ModdleElement[];
};

const EXECUTED_OR_STRUCTURAL = new Set([
  "bpmn:StartEvent",
  "bpmn:EndEvent",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:BusinessRuleTask",
  "bpmn:IntermediateCatchEvent",
  "bpmn:IntermediateThrowEvent",
  "bpmn:SequenceFlow",
]);

const ALLOWED_METADATA = new Set([
  "bpmn:Association",
  "bpmn:DataObject",
  "bpmn:DataObjectReference",
  "bpmn:DataStoreReference",
  "bpmn:Group",
  "bpmn:TextAnnotation",
]);

const KNOWN_EVENT_DEFINITIONS = new Set([
  "bpmn:MessageEventDefinition",
  "bpmn:TerminateEventDefinition",
  "bpmn:TimerEventDefinition",
]);

async function parseBpmnXml(source: string) {
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes === 0) throw new BpmnSourceError("EMPTY_SOURCE", "BPMN source cannot be empty.");
  if (sourceBytes > MAX_BPMN_SOURCE_BYTES) {
    throw new BpmnSourceError("SOURCE_TOO_LARGE", `BPMN source exceeds the ${MAX_BPMN_SOURCE_BYTES}-byte limit.`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new BpmnSourceError("UNSAFE_XML", "DTD and entity declarations are not accepted.");
  }

  const moddle = new BpmnModdle({ wanaflow: wanaflowModdleDescriptor } as never);
  try {
    const parsed = await moddle.fromXML(source);
    return {
      definitions: parsed.rootElement as Definitions,
      warnings: (parsed.warnings ?? []) as unknown[],
    };
  } catch (error) {
    throw new BpmnSourceError(
      "INVALID_BPMN_XML",
      error instanceof Error ? error.message : "The BPMN XML could not be parsed.",
    );
  }
}

function mapping(
  value: string | undefined,
  elementId: string,
  property: string,
  errorCode = "INVALID_FORM_MAPPING",
) {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BpmnSourceError(errorCode, `${property} on ${elementId} must be a JSON object.`);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    Object.entries(parsed).some(([key, entry]) =>
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) ||
      typeof entry !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(entry)
    )
  ) {
    throw new BpmnSourceError(errorCode, `${property} on ${elementId} must map stable top-level keys to stable top-level keys.`);
  }
  if (property.endsWith("OutputMapping") && Object.keys(parsed).some((key) => key.startsWith("wanaflow."))) {
    throw new BpmnSourceError(errorCode, `${property} on ${elementId} cannot write reserved wanaflow.* variables.`);
  }
  return parsed as Record<string, string>;
}

function durationSeconds(value: string | undefined, fallback: number, elementId: string, property: string) {
  if (!value) return fallback;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match || !match.slice(1).some(Boolean)) {
    throw new BpmnSourceError("INVALID_JOB_DURATION", `${property} on ${elementId} must be an ISO-8601 time duration such as PT30S.`);
  }
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function headers(value: string | undefined, elementId: string) {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BpmnSourceError("INVALID_JOB_HEADERS", `jobHeaders on ${elementId} must be a JSON object.`);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    Object.entries(parsed).some(([key, entry]) =>
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) ||
      !(["string", "number", "boolean"].includes(typeof entry) || entry === null)
    )
  ) {
    throw new BpmnSourceError("INVALID_JOB_HEADERS", `jobHeaders on ${elementId} may contain only stable keys and primitive JSON values.`);
  }
  return parsed as ExternalJobBinding["headers"];
}

export async function listBpmnExternalJobBindings(source: string): Promise<ExternalJobBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: ExternalJobBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:ServiceTask" && element.id) {
      if (!element.jobType) {
        throw new BpmnSourceError("EXTERNAL_JOB_TEMPLATE_REQUIRED", `Service task ${element.id} requires a Wanaflow external-job template.`);
      }
      if (!/^[a-z][a-z0-9.-]{1,119}$/.test(element.jobType)) {
        throw new BpmnSourceError("INVALID_JOB_TYPE", `jobType on ${element.id} must use lowercase letters, numbers, dots, or dashes.`);
      }
      const lockDurationSeconds = durationSeconds(element.jobLockDuration, 30, element.id, "jobLockDuration");
      const retryBackoffSeconds = durationSeconds(element.jobRetryBackoff, 10, element.id, "jobRetryBackoff");
      const maxAttempts = element.jobMaxAttempts ?? 3;
      if (lockDurationSeconds < 5 || lockDurationSeconds > 3600) {
        throw new BpmnSourceError("INVALID_JOB_LOCK_DURATION", `jobLockDuration on ${element.id} must be between PT5S and PT1H.`);
      }
      if (retryBackoffSeconds < 1 || retryBackoffSeconds > 86400) {
        throw new BpmnSourceError("INVALID_JOB_RETRY_BACKOFF", `jobRetryBackoff on ${element.id} must be between PT1S and PT24H.`);
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
        throw new BpmnSourceError("INVALID_JOB_MAX_ATTEMPTS", `jobMaxAttempts on ${element.id} must be an integer from 1 to 20.`);
      }
      bindings.push({
        elementId: element.id,
        jobType: element.jobType,
        inputMapping: mapping(element.jobInputMapping, element.id, "jobInputMapping"),
        outputMapping: mapping(element.jobOutputMapping, element.id, "jobOutputMapping"),
        headers: headers(element.jobHeaders, element.id),
        lockDurationSeconds,
        maxAttempts,
        retryBackoffSeconds,
      });
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

export async function listBpmnFormBindings(source: string): Promise<FormBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: FormBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:UserTask" && element.formKey && element.id) {
      bindings.push({
        elementId: element.id,
        formKey: element.formKey,
        inputMapping: mapping(element.inputMapping, element.id, "inputMapping"),
        outputMapping: mapping(element.outputMapping, element.id, "outputMapping"),
      });
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

export async function listBpmnTaskAssignmentBindings(source: string): Promise<UserTaskAssignmentBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: UserTaskAssignmentBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:UserTask" && element.id) {
      if (element.assigneeEmail && element.candidateGroupKey) {
        throw new BpmnSourceError(
          "AMBIGUOUS_TASK_OWNER",
          `User task ${element.id} cannot target both a person and a group.`,
        );
      }
      if (element.assigneeEmail) {
        const email = element.assigneeEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          throw new BpmnSourceError("INVALID_TASK_ASSIGNEE", `assigneeEmail on ${element.id} must be a valid email address.`);
        }
        bindings.push({ elementId: element.id, owner: { kind: "PERSON", email } });
      } else if (element.candidateGroupKey) {
        const groupKey = element.candidateGroupKey.trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{1,63}$/.test(groupKey)) {
          throw new BpmnSourceError(
            "INVALID_TASK_GROUP",
            `candidateGroupKey on ${element.id} must use lowercase letters, numbers, or dashes.`,
          );
        }
        bindings.push({ elementId: element.id, owner: { kind: "GROUP", groupKey } });
      } else {
        bindings.push({ elementId: element.id, owner: { kind: "STARTER" } });
      }
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

export async function listBpmnDecisionBindings(source: string): Promise<DecisionBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: DecisionBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:BusinessRuleTask" && element.id) {
      if (!element.decisionKey || !/^[a-z][a-z0-9.-]{1,119}$/.test(element.decisionKey)) {
        throw new BpmnSourceError(
          "DMN_DECISION_KEY_REQUIRED",
          `Business rule task ${element.id} requires a stable lowercase decision key.`,
        );
      }
      bindings.push({
        elementId: element.id,
        decisionKey: element.decisionKey,
        inputMapping: mapping(
          element.decisionInputMapping,
          element.id,
          "decisionInputMapping",
          "INVALID_DECISION_MAPPING",
        ),
        outputMapping: mapping(
          element.decisionOutputMapping,
          element.id,
          "decisionOutputMapping",
          "INVALID_DECISION_MAPPING",
        ),
      });
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

function timerDurationMilliseconds(value: string, elementId: string) {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?)?$/);
  if (!match || !match.slice(1).some((part) => part !== undefined)) {
    throw new BpmnSourceError(
      "INVALID_TIMER_DURATION",
      `Timer ${elementId} must use an ISO-8601 day/time duration such as PT15M or P1DT2H.`,
    );
  }
  const milliseconds =
    Number(match[1] ?? 0) * 86_400_000 +
    Number(match[2] ?? 0) * 3_600_000 +
    Number(match[3] ?? 0) * 60_000 +
    Number(match[4] ?? 0) * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 315_360_000_000) {
    throw new BpmnSourceError(
      "INVALID_TIMER_DURATION",
      `Timer ${elementId} duration must be between PT0S and ten years.`,
    );
  }
  return milliseconds;
}

function timerDate(value: string, elementId: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new BpmnSourceError(
      "INVALID_TIMER_DATE",
      `Timer ${elementId} must use an ISO-8601 timestamp with Z or an explicit UTC offset.`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BpmnSourceError("INVALID_TIMER_DATE", `Timer ${elementId} contains an invalid calendar date.`);
  }
  return parsed.toISOString();
}

export async function listBpmnTimerBindings(source: string): Promise<TimerBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: TimerBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:IntermediateCatchEvent" && element.id) {
      const timerDefinitions = (element.eventDefinitions ?? []).filter(
        (definition) => definition.$type === "bpmn:TimerEventDefinition",
      );
      if (timerDefinitions.length) {
        if (timerDefinitions.length !== 1 || (element.eventDefinitions?.length ?? 0) !== 1) {
          throw new BpmnSourceError("MULTIPLE_TIMER_DEFINITIONS", `Timer ${element.id} must contain exactly one timer definition.`);
        }
        const definition = timerDefinitions[0];
        if (definition.timeCycle?.body) {
          throw new BpmnSourceError("TIMER_CYCLE_DEFERRED", `Timer ${element.id} cannot use a repeating cycle in the current runtime profile.`);
        }
        const duration = definition.timeDuration?.body?.trim();
        const date = definition.timeDate?.body?.trim();
        if (Boolean(duration) === Boolean(date)) {
          throw new BpmnSourceError(
            "TIMER_EXPRESSION_REQUIRED",
            `Timer ${element.id} must define exactly one timeDuration or timeDate expression.`,
          );
        }
        if (duration) {
          bindings.push({
            elementId: element.id,
            timerType: "DURATION",
            expression: duration,
            durationMilliseconds: timerDurationMilliseconds(duration, element.id),
            dueAt: null,
          });
        } else if (date) {
          bindings.push({
            elementId: element.id,
            timerType: "DATE",
            expression: date,
            durationMilliseconds: null,
            dueAt: timerDate(date, element.id),
          });
        }
      }
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

export async function listBpmnMessageCatchBindings(source: string): Promise<MessageCatchBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: MessageCatchBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:IntermediateCatchEvent" && element.id) {
      const messageDefinitions = (element.eventDefinitions ?? []).filter(
        (definition) => definition.$type === "bpmn:MessageEventDefinition",
      );
      if (messageDefinitions.length) {
        if (messageDefinitions.length !== 1 || (element.eventDefinitions?.length ?? 0) !== 1) {
          throw new BpmnSourceError(
            "MULTIPLE_MESSAGE_DEFINITIONS",
            `Message catch ${element.id} must contain exactly one message definition.`,
          );
        }
        const message = messageDefinitions[0].messageRef;
        if (!message?.id || !message.name) {
          throw new BpmnSourceError(
            "MESSAGE_REFERENCE_REQUIRED",
            `Message catch ${element.id} must reference a named BPMN message.`,
          );
        }
        if (!/^[a-z][a-z0-9.-]{1,119}$/.test(message.name)) {
          throw new BpmnSourceError(
            "INVALID_MESSAGE_NAME",
            `Message ${message.id} must use a stable lowercase name such as order.approved.`,
          );
        }
        if (!element.correlationKey || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(element.correlationKey)) {
          throw new BpmnSourceError(
            "MESSAGE_CORRELATION_KEY_REQUIRED",
            `Message catch ${element.id} must name the process variable that supplies its correlation key.`,
          );
        }
        bindings.push({
          elementId: element.id,
          messageId: message.id,
          messageName: message.name,
          correlationKeyVariable: element.correlationKey,
        });
      }
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

export async function listBpmnMessageThrowBindings(source: string): Promise<MessageThrowBinding[]> {
  const { definitions } = await parseBpmnXml(source);
  const bindings: MessageThrowBinding[] = [];
  const visit = (element: ModdleElement) => {
    if (element.$type === "bpmn:IntermediateThrowEvent" && element.id) {
      const messageDefinitions = (element.eventDefinitions ?? []).filter(
        (definition) => definition.$type === "bpmn:MessageEventDefinition",
      );
      if (messageDefinitions.length) {
        if (messageDefinitions.length !== 1 || (element.eventDefinitions?.length ?? 0) !== 1) {
          throw new BpmnSourceError(
            "MULTIPLE_MESSAGE_DEFINITIONS",
            `Message throw ${element.id} must contain exactly one message definition.`,
          );
        }
        const message = messageDefinitions[0].messageRef;
        if (!message?.id || !message.name) {
          throw new BpmnSourceError(
            "MESSAGE_REFERENCE_REQUIRED",
            `Message throw ${element.id} must reference a named BPMN message.`,
          );
        }
        if (!/^[a-z][a-z0-9.-]{1,119}$/.test(message.name)) {
          throw new BpmnSourceError(
            "INVALID_MESSAGE_NAME",
            `Message ${message.id} must use a stable lowercase name such as order.approved.`,
          );
        }
        if (!element.correlationKey || !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(element.correlationKey)) {
          throw new BpmnSourceError(
            "MESSAGE_CORRELATION_KEY_REQUIRED",
            `Message throw ${element.id} must name the process variable that supplies its correlation key.`,
          );
        }
        bindings.push({
          elementId: element.id,
          messageId: message.id,
          messageName: message.name,
          correlationKeyVariable: element.correlationKey,
          payloadMapping: mapping(
            element.messagePayloadMapping,
            element.id,
            "messagePayloadMapping",
            "INVALID_MESSAGE_PAYLOAD_MAPPING",
          ),
        });
      }
    }
    for (const child of element.flowElements ?? []) visit(child);
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return bindings;
}

function collectElements(element: ModdleElement, references: BpmnElementReference[]) {
  if (element.id && element.$type) {
    references.push({
      id: element.id,
      name: element.name || element.id,
      type: element.$type.replace("bpmn:", ""),
    });
  }
  for (const child of element.flowElements ?? []) collectElements(child, references);
}

export async function listBpmnElements(source: string): Promise<BpmnElementReference[]> {
  const { definitions } = await parseBpmnXml(source);
  if (definitions.$type !== "bpmn:Definitions") {
    throw new BpmnSourceError("INVALID_BPMN_ROOT", "The XML root must be BPMN definitions.");
  }
  const references: BpmnElementReference[] = [];
  for (const root of definitions.rootElements ?? []) collectElements(root, references);
  return references;
}

function issue(
  code: string,
  message: string,
  element?: ModdleElement,
  severity: ValidationIssue["severity"] = "ERROR",
): ValidationIssue {
  return { code, severity, message, ...(element?.id ? { elementId: element.id } : {}) };
}

function validateEvent(element: ModdleElement, issues: ValidationIssue[]) {
  const definitions = element.eventDefinitions ?? [];

  if (definitions.length > 1) {
    issues.push(issue("MULTIPLE_EVENT_DEFINITIONS", "Only one event definition is supported in the MVP.", element));
    return;
  }

  const definition = definitions[0];
  if (!definition) return;

  if (!definition.$type || !KNOWN_EVENT_DEFINITIONS.has(definition.$type)) {
    issues.push(issue("UNSUPPORTED_EVENT_DEFINITION", `The event definition ${definition.$type ?? "unknown"} is not executable in the MVP.`, element));
    return;
  }

  if (element.$type === "bpmn:StartEvent") {
    issues.push(issue("START_EVENT_DEFERRED", "Only a none start event is executable in the MVP.", element));
  }

  if (element.$type === "bpmn:EndEvent" && definition.$type !== "bpmn:TerminateEventDefinition") {
    issues.push(issue("END_EVENT_DEFERRED", "Only none and terminate end events are executable in the MVP.", element));
  }

  if (element.$type === "bpmn:IntermediateCatchEvent" && !new Set(["bpmn:TimerEventDefinition", "bpmn:MessageEventDefinition"]).has(definition.$type)) {
    issues.push(issue("CATCH_EVENT_DEFERRED", "Only timer and message catch events are executable in the MVP.", element));
  }

  if (element.$type === "bpmn:IntermediateThrowEvent" && definition.$type !== "bpmn:MessageEventDefinition") {
    issues.push(issue("THROW_EVENT_DEFERRED", "Only message throw events are executable in the MVP.", element));
  }

  if (element.$type === "bpmn:BoundaryEvent") {
    if (definition.$type !== "bpmn:TimerEventDefinition" || element.cancelActivity === false) {
      issues.push(issue("BOUNDARY_EVENT_DEFERRED", "Only interrupting timer boundary events are executable in the MVP.", element));
    }
  }
}

function validateFlowElement(element: ModdleElement, issues: ValidationIssue[]) {
  if (!element.$type) {
    issues.push(issue("UNKNOWN_ELEMENT", "An element has no BPMN type.", element));
    return;
  }

  if (!EXECUTED_OR_STRUCTURAL.has(element.$type) && !ALLOWED_METADATA.has(element.$type)) {
    issues.push(issue("UNSUPPORTED_EXECUTABLE_ELEMENT", `${element.$type} is preserved for modeling but cannot be published as executable in the MVP.`, element));
  }

  if (element.$type.endsWith("Event")) validateEvent(element, issues);

  for (const child of element.flowElements ?? []) validateFlowElement(child, issues);
}

export async function validateBpmnXml(source: string): Promise<BpmnValidationResult> {
  const { definitions, warnings: parseWarnings } = await parseBpmnXml(source);

  if (definitions.$type !== "bpmn:Definitions") {
    throw new BpmnSourceError("INVALID_BPMN_ROOT", "The XML root must be BPMN definitions.");
  }

  const issues: ValidationIssue[] = parseWarnings.map((warning) => {
    const message =
      typeof warning === "string"
        ? warning
        : typeof warning === "object" && warning !== null && "message" in warning
          ? String(warning.message)
          : "The BPMN parser reported a warning.";
    return issue("BPMN_PARSE_WARNING", message, undefined, "WARNING");
  });
  const processes = (definitions.rootElements ?? []).filter((element) => element.$type === "bpmn:Process");
  const executableProcesses = processes.filter((process) => process.isExecutable === true);

  if (executableProcesses.length !== 1) {
    issues.push(
      issue(
        "EXECUTABLE_PROCESS_COUNT",
        `An executable deployment requires exactly one executable process; found ${executableProcesses.length}.`,
      ),
    );
  }

  for (const process of executableProcesses) {
    for (const element of process.flowElements ?? []) validateFlowElement(element, issues);
  }

  try {
    await listBpmnFormBindings(source);
  } catch (error) {
    issues.push(issue("INVALID_FORM_MAPPING", error instanceof Error ? error.message : "A user-task form mapping is invalid."));
  }
  try {
    await listBpmnTaskAssignmentBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_TASK_OWNER",
      error instanceof Error ? error.message : "A user-task owner is invalid.",
    ));
  }
  try {
    await listBpmnDecisionBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_DECISION_BINDING",
      error instanceof Error ? error.message : "A business-rule decision binding is invalid.",
    ));
  }
  try {
    await listBpmnExternalJobBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_EXTERNAL_JOB_BINDING",
      error instanceof Error ? error.message : "A service-task external-job binding is invalid.",
    ));
  }
  try {
    await listBpmnTimerBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_TIMER_BINDING",
      error instanceof Error ? error.message : "A timer binding is invalid.",
    ));
  }
  try {
    await listBpmnMessageCatchBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_MESSAGE_BINDING",
      error instanceof Error ? error.message : "A message-catch binding is invalid.",
    ));
  }
  try {
    await listBpmnMessageThrowBindings(source);
  } catch (error) {
    issues.push(issue(
      error instanceof BpmnSourceError ? error.code : "INVALID_MESSAGE_BINDING",
      error instanceof Error ? error.message : "A message-throw binding is invalid.",
    ));
  }

  return {
    status: issues.some((entry) => entry.severity === "ERROR") ? "INVALID" : "VALID",
    profile: "wanaflow-bpmn-mvp@1",
    issues,
  };
}
