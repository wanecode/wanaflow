export const WANAFLOW_NAMESPACE_URI = "https://wanaflow.dev/schema/bpmn";

export const wanaflowModdleDescriptor = {
  name: "Wanaflow",
  uri: WANAFLOW_NAMESPACE_URI,
  prefix: "wanaflow",
  xml: { tagAlias: "lowerCase" },
  types: [
    {
      name: "UserTaskBinding",
      extends: ["bpmn:UserTask"],
      properties: [
        { name: "formKey", type: "String", isAttr: true },
        { name: "inputMapping", type: "String", isAttr: true },
        { name: "outputMapping", type: "String", isAttr: true },
        { name: "assigneeEmail", type: "String", isAttr: true },
        { name: "candidateGroupKey", type: "String", isAttr: true },
      ],
    },
    {
      name: "ExternalJobBinding",
      extends: ["bpmn:ServiceTask"],
      properties: [
        { name: "jobType", type: "String", isAttr: true },
        { name: "jobInputMapping", type: "String", isAttr: true },
        { name: "jobOutputMapping", type: "String", isAttr: true },
        { name: "jobHeaders", type: "String", isAttr: true },
        { name: "jobLockDuration", type: "String", isAttr: true },
        { name: "jobMaxAttempts", type: "Integer", isAttr: true },
        { name: "jobRetryBackoff", type: "String", isAttr: true },
      ],
    },
    {
      name: "DecisionBinding",
      extends: ["bpmn:BusinessRuleTask"],
      properties: [
        { name: "decisionKey", type: "String", isAttr: true },
        { name: "decisionInputMapping", type: "String", isAttr: true },
        { name: "decisionOutputMapping", type: "String", isAttr: true },
      ],
    },
    {
      name: "MessageCatchBinding",
      extends: ["bpmn:IntermediateCatchEvent"],
      properties: [
        { name: "correlationKey", type: "String", isAttr: true },
      ],
    },
    {
      name: "MessageThrowBinding",
      extends: ["bpmn:IntermediateThrowEvent"],
      properties: [
        { name: "correlationKey", type: "String", isAttr: true },
        { name: "messagePayloadMapping", type: "String", isAttr: true },
      ],
    },
  ],
} as const;
