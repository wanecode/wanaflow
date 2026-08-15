type ProcessStep = {
  name: string;
  kind: "HUMAN" | "SERVICE" | "DECISION";
  formKey?: string;
  formInputMappings?: Array<{ formField: string; processVariable: string }>;
  formOutputMappings?: Array<{ processVariable: string; formField: string }>;
  jobType?: string;
  decisionKey?: string;
  decisionInputMappings?: Array<{ decisionInput: string; processVariable: string }>;
  decisionOutputMappings?: Array<{ processVariable: string; decisionOutput: string }>;
};

export type ExperienceProcessSpec = {
  key: string;
  name: string;
  startLabel?: string;
  endLabel?: string;
  steps: ProcessStep[];
};

export type ExperienceFormField = {
  key: string;
  label: string;
  type: "textfield" | "textarea" | "number" | "checkbox" | "datetime" | "select" | "radio";
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
};

export type ExperienceFormSpec = {
  key: string;
  name: string;
  description?: string;
  fields: ExperienceFormField[];
};

export type ExperienceDecisionSpec = {
  key: string;
  name: string;
  hitPolicy: "UNIQUE" | "FIRST";
  inputs: Array<{ name: string; label: string; type: "string" | "boolean" | "number" }>;
  outputs: Array<{ name: string; label: string; type: "string" | "boolean" | "number" }>;
  rules: Array<{
    description?: string;
    inputEntries: string[];
    outputEntries: string[];
  }>;
};

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stableXmlId(value: string) {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function stableJobType(name: string) {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120);
  return normalized.length >= 2 ? normalized : "work.execute";
}

export function generateExperienceBpmn(spec: ExperienceProcessSpec) {
  const processId = stableXmlId(spec.key);
  const nodes: Array<{
    id: string;
    type: "startEvent" | "endEvent" | "HUMAN" | "SERVICE" | "DECISION";
    name: string;
    formKey?: string;
    formInputMappings?: Array<{ formField: string; processVariable: string }>;
    formOutputMappings?: Array<{ processVariable: string; formField: string }>;
    jobType?: string;
    decisionKey?: string;
    decisionInputMappings?: Array<{ decisionInput: string; processVariable: string }>;
    decisionOutputMappings?: Array<{ processVariable: string; decisionOutput: string }>;
  }> = [
    { id: "StartEvent_1", type: "startEvent", name: spec.startLabel?.trim() || "Request received" },
    ...spec.steps.map((step, index) => ({ id: `Task_${index + 1}`, type: step.kind, ...step })),
    { id: "EndEvent_1", type: "endEvent", name: spec.endLabel?.trim() || "Work completed" },
  ];
  const flows = nodes.slice(0, -1).map((node, index) => ({
    id: `Flow_${index + 1}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));
  const incoming = new Map(nodes.map((node) => [node.id, flows.find((flow) => flow.target === node.id)?.id]));
  const outgoing = new Map(nodes.map((node) => [node.id, flows.find((flow) => flow.source === node.id)?.id]));
  const nodeXml = nodes.map((node) => {
    const io = `${incoming.get(node.id) ? `<bpmn:incoming>${incoming.get(node.id)}</bpmn:incoming>` : ""}${outgoing.get(node.id) ? `<bpmn:outgoing>${outgoing.get(node.id)}</bpmn:outgoing>` : ""}`;
    if (node.type === "startEvent" || node.type === "endEvent") {
      return `    <bpmn:${node.type} id="${node.id}" name="${xml(node.name)}">${io}</bpmn:${node.type}>`;
    }
    if (node.type === "SERVICE") {
      const jobType = stableJobType(node.jobType || node.name);
      return `    <bpmn:serviceTask id="${node.id}" name="${xml(node.name)}" wanaflow:jobType="${xml(jobType)}" wanaflow:jobInputMapping="{}" wanaflow:jobOutputMapping="{}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="3" wanaflow:jobRetryBackoff="PT10S">${io}</bpmn:serviceTask>`;
    }
    if (node.type === "DECISION") {
      const decisionKey = node.decisionKey || `${spec.key}.decision`;
      const inputMapping = Object.fromEntries((node.decisionInputMappings ?? []).map((entry) => [entry.decisionInput, entry.processVariable]));
      const outputMapping = Object.fromEntries((node.decisionOutputMappings ?? []).map((entry) => [entry.processVariable, entry.decisionOutput]));
      return `    <bpmn:businessRuleTask id="${node.id}" name="${xml(node.name)}" wanaflow:decisionKey="${xml(decisionKey)}" wanaflow:decisionInputMapping="${xml(JSON.stringify(inputMapping))}" wanaflow:decisionOutputMapping="${xml(JSON.stringify(outputMapping))}">${io}</bpmn:businessRuleTask>`;
    }
    const formInputMapping = Object.fromEntries((node.formInputMappings ?? []).map((entry) => [entry.formField, entry.processVariable]));
    const formOutputMapping = Object.fromEntries((node.formOutputMappings ?? []).map((entry) => [entry.processVariable, entry.formField]));
    const formBinding = node.formKey ? ` wanaflow:formKey="${xml(node.formKey)}" wanaflow:inputMapping="${xml(JSON.stringify(formInputMapping))}" wanaflow:outputMapping="${xml(JSON.stringify(formOutputMapping))}"` : "";
    return `    <bpmn:userTask id="${node.id}" name="${xml(node.name)}"${formBinding}>${io}</bpmn:userTask>`;
  }).join("\n");
  const flowXml = flows.map((flow) => `    <bpmn:sequenceFlow id="${flow.id}" sourceRef="${flow.source}" targetRef="${flow.target}" />`).join("\n");
  const startX = 120;
  const gap = 180;
  const shapeXml = nodes.map((node, index) => {
    const event = node.type === "startEvent" || node.type === "endEvent";
    const x = startX + index * gap;
    return `      <bpmndi:BPMNShape id="${node.id}_di" bpmnElement="${node.id}"><dc:Bounds x="${x}" y="${event ? 182 : 160}" width="${event ? 36 : 120}" height="${event ? 36 : 80}" /></bpmndi:BPMNShape>`;
  }).join("\n");
  const edgeXml = flows.map((flow, index) => {
    const source = nodes[index];
    const target = nodes[index + 1];
    const sourceEvent = source.type === "startEvent" || source.type === "endEvent";
    const targetEvent = target.type === "startEvent" || target.type === "endEvent";
    const sourceX = startX + index * gap + (sourceEvent ? 36 : 120);
    const targetX = startX + (index + 1) * gap;
    const targetY = targetEvent ? 200 : 200;
    return `      <bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}"><di:waypoint x="${sourceX}" y="200" /><di:waypoint x="${targetX}" y="${targetY}" /></bpmndi:BPMNEdge>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" id="Definitions_${processId}" targetNamespace="https://wanaflow.dev/bpmn">
  <bpmn:process id="${processId}" name="${xml(spec.name)}" isExecutable="true">
${nodeXml}
${flowXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
${shapeXml}
${edgeXml}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

export function generateExperienceForm(spec: ExperienceFormSpec) {
  const components: Array<Record<string, unknown>> = [
    {
      id: "Intro_1",
      type: "text",
      text: `# ${spec.name}\n\n${spec.description?.trim() || "Complete the details below."}`,
    },
    ...spec.fields.map((field, index) => ({
      id: `Field_${index + 1}`,
      type: field.type,
      key: field.key,
      label: field.label,
      ...(field.required ? { validate: { required: true } } : {}),
      ...(["select", "radio"].includes(field.type) && field.options?.length
        ? { values: field.options }
        : {}),
    })),
  ];
  return JSON.stringify({
    schemaVersion: 19,
    type: "default",
    id: `Form_${stableXmlId(spec.key)}`,
    components,
  }, null, 2);
}

export function generateExperienceDmn(spec: ExperienceDecisionSpec) {
  const id = stableXmlId(spec.key);
  const inputs = spec.inputs.map((input, index) => `      <input id="Input_${index + 1}" label="${xml(input.label)}"><inputExpression id="InputExpression_${index + 1}" typeRef="${input.type}"><text>${xml(input.name)}</text></inputExpression></input>`).join("\n");
  const outputs = spec.outputs.map((output, index) => `      <output id="Output_${index + 1}" name="${xml(output.name)}" label="${xml(output.label)}" typeRef="${output.type}" />`).join("\n");
  const rules = spec.rules.map((rule, ruleIndex) => {
    const inputEntries = rule.inputEntries.map((entry, index) => `<inputEntry id="InputEntry_${ruleIndex + 1}_${index + 1}"><text>${xml(entry || "-")}</text></inputEntry>`).join("");
    const outputEntries = rule.outputEntries.map((entry, index) => `<outputEntry id="OutputEntry_${ruleIndex + 1}_${index + 1}"><text>${xml(entry || "null")}</text></outputEntry>`).join("");
    return `      <rule id="Rule_${ruleIndex + 1}">${rule.description ? `<description>${xml(rule.description)}</description>` : ""}${inputEntries}${outputEntries}</rule>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/" id="Definitions_${id}" name="${xml(spec.name)}" namespace="https://wanaflow.dev/decisions/${xml(spec.key)}">
  <decision id="Decision_${id}" name="${xml(spec.name)}">
    <decisionTable id="DecisionTable_${id}" hitPolicy="${spec.hitPolicy}">
${inputs}
${outputs}
${rules}
    </decisionTable>
  </decision>
</definitions>`;
}
