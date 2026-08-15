export const RUNTIME_PROFILE = "wanaflow-linear-v1" as const;

export type RuntimeVariableValue = null | boolean | number | string | RuntimeVariableValue[] | {
  [key: string]: RuntimeVariableValue;
};

export type RuntimeVariables = Record<string, RuntimeVariableValue>;

export type RuntimeActivityEvent = {
  type: "ACTIVITY_ENTERED" | "ACTIVITY_COMPLETED";
  elementId: string;
  elementName: string;
  elementType: string;
};

export type RuntimeUserTaskWait = {
  kind: "USER_TASK";
  elementId: string;
  elementName: string;
  executionId: string;
  assignmentBinding:
    | { kind: "STARTER" }
    | { kind: "PERSON"; email: string }
    | { kind: "GROUP"; groupKey: string };
  formBinding: {
    formKey: string;
    inputMapping: Record<string, string>;
    outputMapping: Record<string, string>;
  } | null;
};

export type RuntimeExternalJobWait = {
  kind: "EXTERNAL_JOB";
  elementId: string;
  elementName: string;
  executionId: string;
  jobBinding: {
    jobType: string;
    inputMapping: Record<string, string>;
    outputMapping: Record<string, string>;
    headers: Record<string, null | boolean | number | string>;
    lockDurationSeconds: number;
    maxAttempts: number;
    retryBackoffSeconds: number;
  };
};

export type RuntimeTimerWait = {
  kind: "TIMER";
  elementId: string;
  elementName: string;
  executionId: string;
  timerBinding: {
    timerType: "DURATION" | "DATE";
    expression: string;
    durationMilliseconds: number | null;
    dueAt: string | null;
  };
};

export type RuntimeMessageWait = {
  kind: "MESSAGE";
  elementId: string;
  elementName: string;
  executionId: string;
  messageBinding: {
    messageName: string;
    correlationKeyVariable: string;
  };
};

export type RuntimeWait = RuntimeUserTaskWait | RuntimeExternalJobWait | RuntimeTimerWait | RuntimeMessageWait;

export type RuntimeMessageDelivery = {
  elementId: string;
  elementName: string;
  executionId: string;
  messageBinding: {
    messageName: string;
    correlationKeyVariable: string;
    payloadMapping: Record<string, string>;
  };
};

export type RuntimeDecisionSource = {
  key: string;
  artifactVersionId: string;
  contentSha256: string;
  source: string;
};

export type RuntimeDecisionEvaluation = {
  elementId: string;
  elementName: string;
  executionId: string;
  decisionKey: string;
  decisionArtifactVersionId: string;
  decisionContentSha256: string;
  decisionId: string;
  decisionName: string;
  hitPolicy: "UNIQUE" | "FIRST";
  input: RuntimeVariables;
  output: RuntimeVariables | null;
  matchedRuleIds: string[];
};

export type RuntimeEnvelope = {
  schemaVersion: 1;
  adapter: {
    name: "bpmn-engine";
    adapterVersion: string;
    engineVersion: string;
  };
  deploymentHash: string;
  payloadEncoding: "json";
  payload: unknown;
  payloadSha256: string;
};

export type RuntimeAdvanceResult = {
  status: "WAITING" | "COMPLETED";
  envelope: RuntimeEnvelope;
  waits: RuntimeWait[];
  messageDeliveries: RuntimeMessageDelivery[];
  decisionEvaluations: RuntimeDecisionEvaluation[];
  events: RuntimeActivityEvent[];
  variables: RuntimeVariables;
};

export type RuntimeStartInput = {
  instanceId: string;
  deploymentHash: string;
  source: string;
  variables: RuntimeVariables;
  decisions?: RuntimeDecisionSource[];
};

export type RuntimeResumeInput = RuntimeStartInput & {
  envelope: RuntimeEnvelope;
  signal: {
    executionId: string;
    output: RuntimeVariables;
  };
};

export interface RuntimeEnginePort {
  readonly adapterName: "bpmn-engine";
  readonly adapterVersion: string;
  readonly engineVersion: string;
  start(input: RuntimeStartInput): Promise<RuntimeAdvanceResult>;
  resume(input: RuntimeResumeInput): Promise<RuntimeAdvanceResult>;
}
