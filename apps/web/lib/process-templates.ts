type ProcessTemplate = {
  id: string;
  name: string;
  suggestedKey: string;
  description: string;
  promise: string;
  steps: string[];
};

export const processTemplates: ProcessTemplate[] = [
  {
    id: "request-approval",
    name: "Request and approval",
    suggestedKey: "request-approval",
    description: "Collect a request, place it with a reviewer, and record the outcome.",
    promise: "A clear two-person decision",
    steps: ["Prepare request", "Review request"],
  },
  {
    id: "employee-onboarding",
    name: "Employee onboarding",
    suggestedKey: "employee-onboarding",
    description: "Coordinate the essential people steps before a new colleague arrives.",
    promise: "A calmer first day",
    steps: ["Collect employee details", "Prepare workplace access", "Welcome employee"],
  },
  {
    id: "incident-response",
    name: "Incident response",
    suggestedKey: "incident-response",
    description: "Give urgent operational work a visible owner from triage to closure.",
    promise: "One accountable response path",
    steps: ["Triage incident", "Coordinate response", "Close incident"],
  },
];

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function processTemplateSource(templateId: string, key: string, name: string) {
  const template = processTemplates.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error("Choose a starter story.");
  const safeKey = escapeXml(key);
  const safeName = escapeXml(name);
  const nodeIds = ["StartEvent_1", ...template.steps.map((_, index) => `Task_${index + 1}`), "EndEvent_1"];
  const flows = nodeIds.slice(0, -1).map((source, index) => ({ id: `Flow_${index + 1}`, source, target: nodeIds[index + 1] }));
  const shapes = nodeIds.map((id, index) => {
    const event = id.startsWith("Start") || id.startsWith("End");
    const x = 130 + index * 190;
    return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${event ? 182 : 160}" width="${event ? 36 : 126}" height="${event ? 36 : 80}" /></bpmndi:BPMNShape>`;
  }).join("\n      ");
  const edges = flows.map((flow, index) => {
    const sourceEvent = flow.source.startsWith("Start");
    const sourceX = 130 + index * 190 + (sourceEvent ? 36 : 126);
    const targetX = 130 + (index + 1) * 190;
    return `<bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}"><di:waypoint x="${sourceX}" y="200" /><di:waypoint x="${targetX}" y="200" /></bpmndi:BPMNEdge>`;
  }).join("\n      ");
  const tasks = template.steps.map((step, index) => {
    const id = `Task_${index + 1}`;
    return `<bpmn:userTask id="${id}" name="${escapeXml(step)}"><bpmn:incoming>Flow_${index + 1}</bpmn:incoming><bpmn:outgoing>Flow_${index + 2}</bpmn:outgoing></bpmn:userTask>`;
  }).join("\n    ");
  const sequenceFlows = flows.map((flow) => `<bpmn:sequenceFlow id="${flow.id}" sourceRef="${flow.source}" targetRef="${flow.target}" />`).join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${safeKey}" targetNamespace="https://wanaflow.dev/bpmn">
  <bpmn:process id="${safeKey}" name="${safeName}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Request received"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    ${tasks}
    <bpmn:endEvent id="EndEvent_1" name="Complete"><bpmn:incoming>Flow_${flows.length}</bpmn:incoming></bpmn:endEvent>
    ${sequenceFlows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1"><bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${safeKey}">
      ${shapes}
      ${edges}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
