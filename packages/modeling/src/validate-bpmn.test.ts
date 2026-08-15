import { describe, expect, it } from "vitest";

import {
  BpmnSourceError,
  listBpmnExternalJobBindings,
  listBpmnDecisionBindings,
  listBpmnFormBindings,
  listBpmnMessageCatchBindings,
  listBpmnMessageThrowBindings,
  listBpmnTaskAssignmentBindings,
  listBpmnTimerBindings,
  parseFormSource,
  validateBpmnXml,
  validateFormSource,
  validateFormSubmission,
} from "./index";

const validSource = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="https://wanaflow.dev/test">
  <bpmn:process id="simple" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>flow</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow" sourceRef="start" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

describe("validateBpmnXml", () => {
  it("accepts the smallest executable process", async () => {
    await expect(validateBpmnXml(validSource)).resolves.toMatchObject({ status: "VALID", issues: [] });
  });

  it("rejects DTD declarations before parsing", async () => {
    await expect(validateBpmnXml(`<!DOCTYPE foo>${validSource}`)).rejects.toMatchObject({
      code: "UNSAFE_XML",
    } satisfies Partial<BpmnSourceError>);
  });

  it("records unsupported runtime constructs without preventing draft storage", async () => {
    const source = validSource.replace(
      '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
      '<bpmn:scriptTask id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:scriptTask>',
    );
    const validation = await validateBpmnXml(source);
    expect(validation.status).toBe("INVALID");
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "UNSUPPORTED_EXECUTABLE_ELEMENT", elementId: "end" }),
    );
  });
});

describe("business rule decision bindings", () => {
  it("extracts a stable DMN key and explicit variable maps", async () => {
    const bound = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:businessRuleTask id="end" wanaflow:decisionKey="invoice-route" wanaflow:decisionInputMapping="{&quot;amount&quot;:&quot;invoiceAmount&quot;}" wanaflow:decisionOutputMapping="{&quot;isApproved&quot;:&quot;approved&quot;}"><bpmn:incoming>flow</bpmn:incoming></bpmn:businessRuleTask>',
      );
    await expect(listBpmnDecisionBindings(bound)).resolves.toEqual([{
      elementId: "end",
      decisionKey: "invoice-route",
      inputMapping: { amount: "invoiceAmount" },
      outputMapping: { isApproved: "approved" },
    }]);
    await expect(validateBpmnXml(bound)).resolves.toMatchObject({ status: "VALID" });
  });
});

describe("portable forms", () => {
  const formSource = JSON.stringify({
    schemaVersion: 19,
    type: "default",
    components: [
      { id: "decision", type: "textfield", key: "decision", label: "Decision", validate: { required: true, minLength: 2 } },
    ],
  });

  it("validates a form-js schema and its submitted data", () => {
    expect(validateFormSource(formSource)).toMatchObject({ status: "VALID", profile: "wanaflow-form@1" });
    const schema = parseFormSource(formSource);
    expect(validateFormSubmission(schema, {})).toEqual([
      { key: "decision", message: "Decision is required." },
    ]);
    expect(validateFormSubmission(schema, { decision: "Approve" })).toEqual([]);
  });

  it("extracts stable form bindings and explicit maps from BPMN", async () => {
    const bound = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:userTask id="end" wanaflow:formKey="approval-form" wanaflow:inputMapping="{&quot;decision&quot;:&quot;draftDecision&quot;}" wanaflow:outputMapping="{&quot;approvedDecision&quot;:&quot;decision&quot;}"><bpmn:incoming>flow</bpmn:incoming></bpmn:userTask>',
      );
    await expect(listBpmnFormBindings(bound)).resolves.toEqual([{
      elementId: "end",
      formKey: "approval-form",
      inputMapping: { decision: "draftDecision" },
      outputMapping: { approvedDecision: "decision" },
    }]);
  });
});

describe("human task ownership", () => {
  it("extracts starter, person, and claimable team ownership", async () => {
    const base = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:userTask id="end" wanaflow:candidateGroupKey="finance-review"><bpmn:incoming>flow</bpmn:incoming></bpmn:userTask>',
      );
    await expect(listBpmnTaskAssignmentBindings(base)).resolves.toEqual([{
      elementId: "end",
      owner: { kind: "GROUP", groupKey: "finance-review" },
    }]);
    await expect(listBpmnTaskAssignmentBindings(base.replace(
      'wanaflow:candidateGroupKey="finance-review"',
      'wanaflow:assigneeEmail="Reviewer@Example.com"',
    ))).resolves.toEqual([{
      elementId: "end",
      owner: { kind: "PERSON", email: "reviewer@example.com" },
    }]);
    await expect(listBpmnTaskAssignmentBindings(base.replace(' wanaflow:candidateGroupKey="finance-review"', "")))
      .resolves.toEqual([{ elementId: "end", owner: { kind: "STARTER" } }]);
  });

  it("rejects an ambiguous owner contract", async () => {
    const source = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:userTask id="end" wanaflow:assigneeEmail="reviewer@example.com" wanaflow:candidateGroupKey="finance-review"><bpmn:incoming>flow</bpmn:incoming></bpmn:userTask>',
      );
    await expect(listBpmnTaskAssignmentBindings(source)).rejects.toMatchObject({ code: "AMBIGUOUS_TASK_OWNER" });
  });
});

describe("external job templates", () => {
  it("extracts worker delivery policy and explicit maps", async () => {
    const bound = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:serviceTask id="end" wanaflow:jobType="invoice.send" wanaflow:jobInputMapping="{&quot;invoice&quot;:&quot;invoiceId&quot;}" wanaflow:jobOutputMapping="{&quot;receiptId&quot;:&quot;receipt&quot;}" wanaflow:jobHeaders="{&quot;region&quot;:&quot;west&quot;}" wanaflow:jobLockDuration="PT45S" wanaflow:jobMaxAttempts="4" wanaflow:jobRetryBackoff="PT5S"><bpmn:incoming>flow</bpmn:incoming></bpmn:serviceTask>',
      );
    await expect(listBpmnExternalJobBindings(bound)).resolves.toEqual([{
      elementId: "end",
      jobType: "invoice.send",
      inputMapping: { invoice: "invoiceId" },
      outputMapping: { receiptId: "receipt" },
      headers: { region: "west" },
      lockDurationSeconds: 45,
      maxAttempts: 4,
      retryBackoffSeconds: 5,
    }]);
  });

  it("requires every service task to declare a valid worker contract", async () => {
    const unbound = validSource.replaceAll("endEvent", "serviceTask");
    await expect(listBpmnExternalJobBindings(unbound)).rejects.toMatchObject({ code: "EXTERNAL_JOB_TEMPLATE_REQUIRED" });
  });
});

describe("durable timer bindings", () => {
  it("extracts duration and absolute-date timers as normalized bindings", async () => {
    const duration = validSource.replace(
      '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
      '<bpmn:intermediateCatchEvent id="end"><bpmn:incoming>flow</bpmn:incoming><bpmn:timerEventDefinition><bpmn:timeDuration>PT15M</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
    );
    await expect(listBpmnTimerBindings(duration)).resolves.toEqual([{
      elementId: "end",
      timerType: "DURATION",
      expression: "PT15M",
      durationMilliseconds: 900_000,
      dueAt: null,
    }]);

    const date = duration.replace("<bpmn:timeDuration>PT15M</bpmn:timeDuration>", "<bpmn:timeDate>2030-06-02T10:30:00+02:00</bpmn:timeDate>");
    await expect(listBpmnTimerBindings(date)).resolves.toEqual([expect.objectContaining({
      timerType: "DATE",
      expression: "2030-06-02T10:30:00+02:00",
      dueAt: "2030-06-02T08:30:00.000Z",
    })]);
  });

  it("rejects cycles, missing expressions, and offset-free dates", async () => {
    const base = validSource.replace(
      '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
      '<bpmn:intermediateCatchEvent id="end"><bpmn:incoming>flow</bpmn:incoming><bpmn:timerEventDefinition>EXPRESSION</bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
    );
    await expect(listBpmnTimerBindings(base.replace("EXPRESSION", "<bpmn:timeCycle>R/PT1H</bpmn:timeCycle>")))
      .rejects.toMatchObject({ code: "TIMER_CYCLE_DEFERRED" });
    await expect(listBpmnTimerBindings(base.replace("EXPRESSION", "")))
      .rejects.toMatchObject({ code: "TIMER_EXPRESSION_REQUIRED" });
    await expect(listBpmnTimerBindings(base.replace("EXPRESSION", "<bpmn:timeDate>2030-06-02T10:30:00</bpmn:timeDate>")))
      .rejects.toMatchObject({ code: "INVALID_TIMER_DATE" });
  });
});

describe("durable message catches", () => {
  it("extracts the standard BPMN message name and Wanaflow correlation variable", async () => {
    const source = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:definitions xmlns:wanaflow="https://wanaflow.dev/schema/bpmn"',
        '<bpmn:definitions xmlns:wanaflow="https://wanaflow.dev/schema/bpmn"',
      )
      .replace(
        '<bpmn:process id="simple" isExecutable="true">',
        '<bpmn:message id="Message_order_approved" name="order.approved" /><bpmn:process id="simple" isExecutable="true">',
      )
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:intermediateCatchEvent id="end" wanaflow:correlationKey="orderId"><bpmn:incoming>flow</bpmn:incoming><bpmn:messageEventDefinition messageRef="Message_order_approved" /></bpmn:intermediateCatchEvent>',
      );
    await expect(listBpmnMessageCatchBindings(source)).resolves.toEqual([{
      elementId: "end",
      messageId: "Message_order_approved",
      messageName: "order.approved",
      correlationKeyVariable: "orderId",
    }]);
  });

  it("requires a named message reference and a stable correlation variable", async () => {
    const source = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:intermediateCatchEvent id="end"><bpmn:incoming>flow</bpmn:incoming><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>',
      );
    await expect(listBpmnMessageCatchBindings(source)).rejects.toMatchObject({ code: "MESSAGE_REFERENCE_REQUIRED" });
  });
});

describe("durable message throws", () => {
  it("extracts the standard message contract and outbound payload mapping", async () => {
    const source = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:process id="simple" isExecutable="true">',
        '<bpmn:message id="Message_order_approved" name="order.approved" /><bpmn:process id="simple" isExecutable="true">',
      )
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:intermediateThrowEvent id="end" wanaflow:correlationKey="orderId" wanaflow:messagePayloadMapping="{&quot;approvalRef&quot;:&quot;approvalRef&quot;}"><bpmn:incoming>flow</bpmn:incoming><bpmn:messageEventDefinition messageRef="Message_order_approved" /></bpmn:intermediateThrowEvent>',
      );
    await expect(listBpmnMessageThrowBindings(source)).resolves.toEqual([{
      elementId: "end",
      messageId: "Message_order_approved",
      messageName: "order.approved",
      correlationKeyVariable: "orderId",
      payloadMapping: { approvalRef: "approvalRef" },
    }]);
  });

  it("rejects an invalid outbound payload mapping", async () => {
    const source = validSource
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:process id="simple" isExecutable="true">',
        '<bpmn:message id="Message_order_approved" name="order.approved" /><bpmn:process id="simple" isExecutable="true">',
      )
      .replace(
        '<bpmn:endEvent id="end"><bpmn:incoming>flow</bpmn:incoming></bpmn:endEvent>',
        '<bpmn:intermediateThrowEvent id="end" wanaflow:correlationKey="orderId" wanaflow:messagePayloadMapping="[]"><bpmn:incoming>flow</bpmn:incoming><bpmn:messageEventDefinition messageRef="Message_order_approved" /></bpmn:intermediateThrowEvent>',
      );
    await expect(listBpmnMessageThrowBindings(source)).rejects.toMatchObject({ code: "INVALID_MESSAGE_PAYLOAD_MAPPING" });
  });
});
