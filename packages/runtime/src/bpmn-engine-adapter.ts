import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";

import { Engine, type Execution } from "bpmn-engine";
import { SignalEventDefinition, SignalTask, Task } from "bpmn-elements";
import {
  evaluateParsedDmnDecision,
  listBpmnDecisionBindings,
  listBpmnExternalJobBindings,
  listBpmnFormBindings,
  listBpmnTaskAssignmentBindings,
  listBpmnMessageCatchBindings,
  listBpmnMessageThrowBindings,
  listBpmnTimerBindings,
  parseDmnDecision,
  wanaflowModdleDescriptor,
  type DecisionBinding,
  type DmnDecisionDefinition,
  type ExternalJobBinding,
  type FormBinding,
  type MessageCatchBinding,
  type MessageThrowBinding,
  type TimerBinding,
  type UserTaskAssignmentBinding,
} from "@wanaflow/modeling";

import { RuntimeAdapterError } from "./errors";
import { assertRuntimeProfile } from "./profile";
import type {
  RuntimeActivityEvent,
  RuntimeAdvanceResult,
  RuntimeEnginePort,
  RuntimeEnvelope,
  RuntimeResumeInput,
  RuntimeStartInput,
  RuntimeMessageDelivery,
  RuntimeDecisionEvaluation,
  RuntimeDecisionSource,
  RuntimeVariables,
  RuntimeWait,
} from "./types";

const ENGINE_VERSION = "25.0.1";
const ADAPTER_VERSION = "1.0.0";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

type ElementApi = {
  id?: string;
  name?: string;
  type?: string;
  executionId?: string;
  content?: {
    id?: string;
    name?: string;
    type?: string;
    executionId?: string;
  };
  environment?: { variables?: RuntimeVariables };
};

function elementData(api: ElementApi) {
  return {
    elementId: api.id ?? api.content?.id ?? "unknown",
    elementName: api.name ?? api.content?.name ?? api.id ?? api.content?.id ?? "Unnamed element",
    elementType: (api.type ?? api.content?.type ?? "unknown").replace(/^bpmn:/, ""),
    executionId: api.executionId ?? api.content?.executionId ?? "",
  };
}

function listenerFor(
  events: RuntimeActivityEvent[],
  messageThrowBindings: Map<string, MessageThrowBinding>,
  messageDeliveries: RuntimeMessageDelivery[],
  decisionBindings: Map<string, DecisionBinding>,
  decisions: Map<string, { source: RuntimeDecisionSource; definition: DmnDecisionDefinition }>,
  variables: RuntimeVariables,
  decisionEvaluations: RuntimeDecisionEvaluation[],
) {
  const listener = new EventEmitter();
  const capturedDeliveries = new Set<string>();
  listener.on("activity.enter", (api: ElementApi) => {
    const element = elementData(api);
    events.push({ type: "ACTIVITY_ENTERED", ...element });
    const binding = decisionBindings.get(element.elementId);
    if (binding) {
      const deployed = decisions.get(binding.decisionKey);
      if (!deployed) {
        throw new RuntimeAdapterError(
          "DEPLOYED_DECISION_NOT_FOUND",
          `The immutable deployment does not contain decision ${binding.decisionKey}.`,
        );
      }
      const decisionInput: RuntimeVariables = {};
      for (const [decisionInputName, variableName] of Object.entries(binding.inputMapping)) {
        if (Object.hasOwn(variables, variableName)) decisionInput[decisionInputName] = variables[variableName];
      }
      const result = evaluateParsedDmnDecision(deployed.definition, decisionInput);
      if (result.output) {
        for (const [processVariable, decisionOutputName] of Object.entries(binding.outputMapping)) {
          if (Object.hasOwn(result.output, decisionOutputName)) variables[processVariable] = result.output[decisionOutputName];
        }
        Object.assign(api.environment?.variables ?? {}, variables);
      }
      decisionEvaluations.push({
        elementId: element.elementId,
        elementName: element.elementName,
        executionId: element.executionId || element.elementId,
        decisionKey: binding.decisionKey,
        decisionArtifactVersionId: deployed.source.artifactVersionId,
        decisionContentSha256: deployed.source.contentSha256,
        decisionId: result.decisionId,
        decisionName: result.decisionName,
        hitPolicy: result.hitPolicy,
        input: decisionInput,
        output: result.output,
        matchedRuleIds: result.matchedRuleIds,
      });
    }
  });
  listener.on("activity.end", (api: ElementApi) => {
    const element = elementData(api);
    events.push({ type: "ACTIVITY_COMPLETED", ...element });
    const binding = messageThrowBindings.get(element.elementId);
    if (binding && !capturedDeliveries.has(element.elementId)) {
      capturedDeliveries.add(element.elementId);
      messageDeliveries.push({
        elementId: element.elementId,
        elementName: element.elementName,
        executionId: element.executionId || element.elementId,
        messageBinding: {
          messageName: binding.messageName,
          correlationKeyVariable: binding.correlationKeyVariable,
          payloadMapping: binding.payloadMapping,
        },
      });
    }
  });
  return listener;
}

type DurableMessageActivity = {
  isThrowing: boolean;
  broker: { publish: (exchange: string, routingKey: string, content: unknown) => unknown };
};

type DurableMessageDefinition = {
  execute: (message: { content: Record<string, unknown> }) => unknown;
};

function DurableMessageEventDefinition(activity: DurableMessageActivity, eventDefinition: unknown) {
  const SignalEventDefinitionConstructor = SignalEventDefinition as unknown as new (
    activity: DurableMessageActivity,
    eventDefinition: unknown,
  ) => DurableMessageDefinition;
  const definition = new SignalEventDefinitionConstructor(activity, eventDefinition);
  if (activity.isThrowing) {
    definition.execute = (executeMessage) => activity.broker.publish(
      "execution",
      "execute.completed",
      { ...executeMessage.content },
    );
  }
  return definition;
}

function waitsFrom(
  execution: Execution,
  formBindings: Map<string, FormBinding>,
  assignmentBindings: Map<string, UserTaskAssignmentBinding>,
  jobBindings: Map<string, ExternalJobBinding>,
  timerBindings: Map<string, TimerBinding>,
  messageBindings: Map<string, MessageCatchBinding>,
): RuntimeWait[] {
  return execution.getPostponed().map((api) => {
    const element = elementData(api as ElementApi);
    if (!/UserTask$|ServiceTask$|IntermediateCatchEvent$|TimerEventDefinition$|MessageEventDefinition$/i.test(element.elementType) || !element.executionId) {
      throw new RuntimeAdapterError(
        "UNSUPPORTED_ENGINE_WAIT",
        `The engine stopped at unsupported ${element.elementType} <${element.elementId}>.`,
      );
    }
    if (/ServiceTask$/i.test(element.elementType)) {
      const binding = jobBindings.get(element.elementId);
      if (!binding) throw new RuntimeAdapterError("EXTERNAL_JOB_BINDING_MISSING", `Service task <${element.elementId}> has no validated external-job binding.`);
      return {
        kind: "EXTERNAL_JOB" as const,
        elementId: element.elementId,
        elementName: element.elementName,
        executionId: element.executionId,
        jobBinding: {
          jobType: binding.jobType,
          inputMapping: binding.inputMapping,
          outputMapping: binding.outputMapping,
          headers: binding.headers,
          lockDurationSeconds: binding.lockDurationSeconds,
          maxAttempts: binding.maxAttempts,
          retryBackoffSeconds: binding.retryBackoffSeconds,
        },
      };
    }
    if (/IntermediateCatchEvent$|TimerEventDefinition$|MessageEventDefinition$/i.test(element.elementType)) {
      const binding = timerBindings.get(element.elementId);
      if (binding) {
        return {
          kind: "TIMER" as const,
          elementId: element.elementId,
          elementName: element.elementName,
          executionId: element.executionId,
          timerBinding: {
            timerType: binding.timerType,
            expression: binding.expression,
            durationMilliseconds: binding.durationMilliseconds,
            dueAt: binding.dueAt,
          },
        };
      }
      const messageBinding = messageBindings.get(element.elementId);
      if (messageBinding) {
        return {
          kind: "MESSAGE" as const,
          elementId: element.elementId,
          elementName: element.elementName,
          executionId: element.executionId,
          messageBinding: {
            messageName: messageBinding.messageName,
            correlationKeyVariable: messageBinding.correlationKeyVariable,
          },
        };
      }
      throw new RuntimeAdapterError(
        "DURABLE_CATCH_BINDING_MISSING",
        `Catch event <${element.elementId}> has no validated durable timer or message binding.`,
      );
    }
    return {
      kind: "USER_TASK" as const,
      elementId: element.elementId,
      elementName: element.elementName,
      executionId: element.executionId,
      assignmentBinding: assignmentBindings.get(element.elementId)?.owner ?? { kind: "STARTER" as const },
      formBinding: formBindings.has(element.elementId)
        ? {
            formKey: formBindings.get(element.elementId)!.formKey,
            inputMapping: formBindings.get(element.elementId)!.inputMapping,
            outputMapping: formBindings.get(element.elementId)!.outputMapping,
          }
        : null,
    };
  });
}

async function resultFrom(
  execution: Execution,
  input: {
    deploymentHash: string;
    events: RuntimeActivityEvent[];
    variables: RuntimeVariables;
    formBindings: Map<string, FormBinding>;
    assignmentBindings: Map<string, UserTaskAssignmentBinding>;
    jobBindings: Map<string, ExternalJobBinding>;
    timerBindings: Map<string, TimerBinding>;
    messageBindings: Map<string, MessageCatchBinding>;
    messageDeliveries: RuntimeMessageDelivery[];
    decisionEvaluations: RuntimeDecisionEvaluation[];
  },
): Promise<RuntimeAdvanceResult> {
  const waits = waitsFrom(execution, input.formBindings, input.assignmentBindings, input.jobBindings, input.timerBindings, input.messageBindings);
  if (waits.length > 1) {
    throw new RuntimeAdapterError(
      "MULTIPLE_CONCURRENT_WAITS",
      "Runtime v1 does not support more than one concurrent managed wait.",
    );
  }
  const state = await Promise.resolve(execution.getState());
  const payload = JSON.parse(JSON.stringify(state)) as unknown;
  const envelope: RuntimeEnvelope = {
    schemaVersion: 1,
    adapter: {
      name: "bpmn-engine",
      adapterVersion: ADAPTER_VERSION,
      engineVersion: ENGINE_VERSION,
    },
    deploymentHash: input.deploymentHash,
    payloadEncoding: "json",
    payload,
    payloadSha256: sha256(payload),
  };
  return {
    status: waits.length ? "WAITING" : "COMPLETED",
    envelope,
    waits,
    messageDeliveries: input.messageDeliveries,
    decisionEvaluations: input.decisionEvaluations,
    events: input.events,
    variables: input.variables,
  };
}

export class BpmnEngineAdapter implements RuntimeEnginePort {
  readonly adapterName = "bpmn-engine" as const;
  readonly adapterVersion = ADAPTER_VERSION;
  readonly engineVersion = ENGINE_VERSION;

  async start(input: RuntimeStartInput): Promise<RuntimeAdvanceResult> {
    await assertRuntimeProfile(input.source);
    const formBindings = new Map((await listBpmnFormBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const assignmentBindings = new Map((await listBpmnTaskAssignmentBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const jobBindings = new Map((await listBpmnExternalJobBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const timerBindings = new Map((await listBpmnTimerBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const messageBindings = new Map((await listBpmnMessageCatchBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const messageThrowBindings = new Map((await listBpmnMessageThrowBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const decisionBindings = new Map((await listBpmnDecisionBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const decisions = new Map(await Promise.all((input.decisions ?? []).map(async (source) => [source.key, { source, definition: await parseDmnDecision(source.source) }] as const)));
    const events: RuntimeActivityEvent[] = [];
    const messageDeliveries: RuntimeMessageDelivery[] = [];
    const decisionEvaluations: RuntimeDecisionEvaluation[] = [];
    const variables = structuredClone(input.variables);
    try {
      const engine = new Engine({
        name: input.instanceId,
        source: input.source,
        disableDummyScript: true,
        moddleOptions: { wanaflow: wanaflowModdleDescriptor },
        elements: {
          ServiceTask: SignalTask,
          BusinessRuleTask: Task,
          TimerEventDefinition: SignalEventDefinition,
          MessageEventDefinition: DurableMessageEventDefinition,
        },
      });
      const execution = await engine.execute({
        listener: listenerFor(events, messageThrowBindings, messageDeliveries, decisionBindings, decisions, variables, decisionEvaluations),
        variables,
      });
      return await resultFrom(execution, {
        deploymentHash: input.deploymentHash,
        events,
        variables,
        formBindings,
        assignmentBindings,
        jobBindings,
        timerBindings,
        messageBindings,
        messageDeliveries,
        decisionEvaluations,
      });
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError(
        "ENGINE_START_FAILED",
        error instanceof Error ? error.message : "bpmn-engine failed to start the process.",
        { cause: error },
      );
    }
  }

  async resume(input: RuntimeResumeInput): Promise<RuntimeAdvanceResult> {
    await assertRuntimeProfile(input.source);
    const formBindings = new Map((await listBpmnFormBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const assignmentBindings = new Map((await listBpmnTaskAssignmentBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const jobBindings = new Map((await listBpmnExternalJobBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const timerBindings = new Map((await listBpmnTimerBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const messageBindings = new Map((await listBpmnMessageCatchBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const messageThrowBindings = new Map((await listBpmnMessageThrowBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const decisionBindings = new Map((await listBpmnDecisionBindings(input.source)).map((binding) => [binding.elementId, binding]));
    const decisions = new Map(await Promise.all((input.decisions ?? []).map(async (source) => [source.key, { source, definition: await parseDmnDecision(source.source) }] as const)));
    if (
      input.envelope.schemaVersion !== 1 ||
      input.envelope.adapter.name !== this.adapterName ||
      input.envelope.adapter.adapterVersion !== this.adapterVersion ||
      input.envelope.adapter.engineVersion !== this.engineVersion ||
      input.envelope.deploymentHash !== input.deploymentHash ||
      input.envelope.payloadEncoding !== "json" ||
      input.envelope.payloadSha256 !== sha256(input.envelope.payload)
    ) {
      throw new RuntimeAdapterError(
        "INCOMPATIBLE_ENGINE_ENVELOPE",
        "The persisted checkpoint is not compatible with this deployment and adapter.",
      );
    }

    const events: RuntimeActivityEvent[] = [];
    const messageDeliveries: RuntimeMessageDelivery[] = [];
    const decisionEvaluations: RuntimeDecisionEvaluation[] = [];
    const variables = { ...structuredClone(input.variables), ...structuredClone(input.signal.output) };
    try {
      const engine = new Engine({
        name: input.instanceId,
        source: input.source,
        disableDummyScript: true,
        moddleOptions: { wanaflow: wanaflowModdleDescriptor },
        elements: {
          ServiceTask: SignalTask,
          BusinessRuleTask: Task,
          TimerEventDefinition: SignalEventDefinition,
          MessageEventDefinition: DurableMessageEventDefinition,
        },
      });
      engine.recover(input.envelope.payload);
      const execution = await engine.resume({ listener: listenerFor(events, messageThrowBindings, messageDeliveries, decisionBindings, decisions, variables, decisionEvaluations) });
      const wait = execution
        .getPostponed()
        .find((api) => elementData(api as ElementApi).executionId === input.signal.executionId);
      if (!wait) {
        throw new RuntimeAdapterError(
          "WAIT_NOT_RECOVERED",
          "The persisted user task is not present in the recovered engine state.",
        );
      }
      execution.signal({ executionId: input.signal.executionId, ...input.signal.output });
      await Promise.resolve();
      return await resultFrom(execution, {
        deploymentHash: input.deploymentHash,
        events,
        variables,
        formBindings,
        assignmentBindings,
        jobBindings,
        timerBindings,
        messageBindings,
        messageDeliveries,
        decisionEvaluations,
      });
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError(
        "ENGINE_RESUME_FAILED",
        error instanceof Error ? error.message : "bpmn-engine failed to resume the process.",
        { cause: error },
      );
    }
  }
}
