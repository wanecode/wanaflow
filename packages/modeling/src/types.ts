export type ValidationSeverity = "ERROR" | "WARNING";

export type ValidationIssue = {
  code: string;
  severity: ValidationSeverity;
  message: string;
  elementId?: string;
};

export type BpmnValidationResult = {
  status: "VALID" | "INVALID";
  profile: "wanaflow-bpmn-mvp@1";
  issues: ValidationIssue[];
};

export type FormValidationResult = {
  status: "VALID" | "INVALID";
  profile: "wanaflow-form@1";
  issues: ValidationIssue[];
};

export type RuntimeJsonValue = null | boolean | number | string | RuntimeJsonValue[] | {
  [key: string]: RuntimeJsonValue;
};

export type RuntimeJsonObject = Record<string, RuntimeJsonValue>;

export type DmnDecisionDefinition = {
  id: string;
  name: string;
  tableId: string;
  hitPolicy: "UNIQUE" | "FIRST";
  inputs: Array<{ id: string; name: string; label: string; type: "string" | "boolean" | "number" }>;
  outputs: Array<{ id: string; name: string; label: string; type: "string" | "boolean" | "number" }>;
  rules: Array<{ id: string; description: string | null; inputEntries: string[]; outputEntries: string[] }>;
};

export type DmnValidationResult = {
  status: "VALID" | "INVALID";
  profile: "wanaflow-dmn-table@1";
  decision: DmnDecisionDefinition | null;
  issues: ValidationIssue[];
};

export type DmnEvaluationResult = {
  decisionId: string;
  decisionName: string;
  hitPolicy: "UNIQUE" | "FIRST";
  matchedRuleIds: string[];
  output: RuntimeJsonObject | null;
};

export type ArtifactValidationResult = BpmnValidationResult | DmnValidationResult | FormValidationResult;

export type FormFieldError = {
  key: string;
  message: string;
};

export type FormBinding = {
  elementId: string;
  formKey: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
};

export type UserTaskAssignmentBinding = {
  elementId: string;
  owner:
    | { kind: "STARTER" }
    | { kind: "PERSON"; email: string }
    | { kind: "GROUP"; groupKey: string };
};

export type DecisionBinding = {
  elementId: string;
  decisionKey: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
};

export type ExternalJobBinding = {
  elementId: string;
  jobType: string;
  inputMapping: Record<string, string>;
  outputMapping: Record<string, string>;
  headers: Record<string, null | boolean | number | string>;
  lockDurationSeconds: number;
  maxAttempts: number;
  retryBackoffSeconds: number;
};

export type TimerBinding = {
  elementId: string;
  timerType: "DURATION" | "DATE";
  expression: string;
  durationMilliseconds: number | null;
  dueAt: string | null;
};

export type MessageCatchBinding = {
  elementId: string;
  messageId: string;
  messageName: string;
  correlationKeyVariable: string;
};

export type MessageThrowBinding = {
  elementId: string;
  messageId: string;
  messageName: string;
  correlationKeyVariable: string;
  payloadMapping: Record<string, string>;
};

export type BpmnElementReference = {
  id: string;
  name: string;
  type: string;
};

export class BpmnSourceError extends Error {
  readonly code: string;
  readonly issues: ValidationIssue[];

  constructor(code: string, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "BpmnSourceError";
    this.code = code;
    this.issues = issues;
  }
}
