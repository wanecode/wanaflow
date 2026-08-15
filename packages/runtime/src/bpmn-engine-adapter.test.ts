import { describe, expect, it } from "vitest";

import { BpmnEngineAdapter } from "./bpmn-engine-adapter";
import { RuntimeProfileError } from "./errors";

const source = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://wanaflow.dev/runtime-test">
  <bpmn:process id="approval" name="Simple approval" isExecutable="true">
    <bpmn:startEvent id="start" name="Request received" />
    <bpmn:userTask id="approve" name="Approve request" />
    <bpmn:endEvent id="end" name="Request approved" />
    <bpmn:sequenceFlow id="to-approve" sourceRef="start" targetRef="approve" />
    <bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

const decisionSource = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_route" namespace="https://wanaflow.dev/test">
  <decision id="Decision_route" name="Invoice route">
    <decisionTable id="Table_route" hitPolicy="UNIQUE">
      <input id="Input_amount" label="Amount"><inputExpression id="Expr_amount" typeRef="number"><text>amount</text></inputExpression></input>
      <output id="Output_approved" name="approved" label="Approved" typeRef="boolean" />
      <rule id="Rule_auto"><inputEntry id="InputEntry_auto"><text>&lt;= 1000</text></inputEntry><outputEntry id="OutputEntry_auto"><text>true</text></outputEntry></rule>
      <rule id="Rule_manual"><inputEntry id="InputEntry_manual"><text>&gt; 1000</text></inputEntry><outputEntry id="OutputEntry_manual"><text>false</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

describe("BpmnEngineAdapter", () => {
  it("persists a user-task wait and resumes it to completion", async () => {
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "a".repeat(64),
      source,
      variables: { requestId: "REQ-42" },
    });

    expect(waiting.status).toBe("WAITING");
    expect(waiting.waits).toEqual([
      expect.objectContaining({ elementId: "approve", elementName: "Approve request" }),
    ]);
    expect(waiting.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ACTIVITY_COMPLETED", elementId: "start" }),
        expect.objectContaining({ type: "ACTIVITY_ENTERED", elementId: "approve" }),
      ]),
    );

    const completed = await adapter.resume({
      instanceId: crypto.randomUUID(),
      deploymentHash: "a".repeat(64),
      source,
      variables: waiting.variables,
      envelope: waiting.envelope,
      signal: { executionId: waiting.waits[0].executionId, output: { approved: true } },
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.waits).toEqual([]);
    expect(completed.variables).toMatchObject({ requestId: "REQ-42", approved: true });
    expect(completed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ACTIVITY_COMPLETED", elementId: "approve" }),
        expect.objectContaining({ type: "ACTIVITY_COMPLETED", elementId: "end" }),
      ]),
    );
  });

  it("rejects elements outside the executable runtime-v1 subset", async () => {
    const adapter = new BpmnEngineAdapter();
    await expect(
      adapter.start({
        instanceId: crypto.randomUUID(),
        deploymentHash: "b".repeat(64),
        source: source.replace("<bpmn:userTask", "<bpmn:manualTask").replace("</bpmn:userTask>", "</bpmn:manualTask>"),
        variables: {},
      }),
    ).rejects.toBeInstanceOf(RuntimeProfileError);
  });

  it("rejects branching paths before constructing the engine", async () => {
    const adapter = new BpmnEngineAdapter();
    const branched = source.replace(
      '<bpmn:sequenceFlow id="to-approve" sourceRef="start" targetRef="approve" />',
      '<bpmn:sequenceFlow id="to-approve" sourceRef="start" targetRef="approve" />\n    <bpmn:sequenceFlow id="skip" sourceRef="start" targetRef="end" />',
    );
    await expect(
      adapter.start({
        instanceId: crypto.randomUUID(),
        deploymentHash: "c".repeat(64),
        source: branched,
        variables: {},
      }),
    ).rejects.toMatchObject({ code: "NON_LINEAR_RUNTIME_FLOW" });
  });

  it("projects the Wanaflow form binding without coupling it to engine state", async () => {
    const boundSource = source
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:userTask id="approve" name="Approve request" />',
        '<bpmn:userTask id="approve" name="Approve request" wanaflow:formKey="approval-form" wanaflow:inputMapping="{&quot;requester&quot;:&quot;requestId&quot;}" wanaflow:outputMapping="{&quot;approved&quot;:&quot;decision&quot;}" />',
      );
    const waiting = await new BpmnEngineAdapter().start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "d".repeat(64),
      source: boundSource,
      variables: { requestId: "REQ-7" },
    });
    expect(waiting.waits[0]?.kind).toBe("USER_TASK");
    if (waiting.waits[0]?.kind !== "USER_TASK") throw new Error("Expected a user-task wait.");
    expect(waiting.waits[0].formBinding).toEqual({
      formKey: "approval-form",
      inputMapping: { requester: "requestId" },
      outputMapping: { approved: "decision" },
    });
  });

  it("turns a modeled service task into an external-job wait", async () => {
    const jobSource = source
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:userTask id="approve" name="Approve request" />',
        '<bpmn:serviceTask id="approve" name="Send decision" wanaflow:jobType="decision.send" wanaflow:jobInputMapping="{&quot;request&quot;:&quot;requestId&quot;}" wanaflow:jobOutputMapping="{&quot;receiptId&quot;:&quot;receipt&quot;}" wanaflow:jobHeaders="{&quot;region&quot;:&quot;west&quot;}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="3" wanaflow:jobRetryBackoff="PT10S" />',
      );
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "e".repeat(64),
      source: jobSource,
      variables: { requestId: "REQ-9" },
    });
    expect(waiting.waits[0]).toMatchObject({
      kind: "EXTERNAL_JOB",
      elementId: "approve",
      jobBinding: { jobType: "decision.send", maxAttempts: 3, lockDurationSeconds: 30 },
    });
    const wait = waiting.waits[0];
    if (wait?.kind !== "EXTERNAL_JOB") throw new Error("Expected an external-job wait.");
    const completed = await adapter.resume({
      instanceId: crypto.randomUUID(),
      deploymentHash: "e".repeat(64),
      source: jobSource,
      variables: waiting.variables,
      envelope: waiting.envelope,
      signal: { executionId: wait.executionId, output: { receiptId: "R-1" } },
    });
    expect(completed).toMatchObject({ status: "COMPLETED", variables: { requestId: "REQ-9", receiptId: "R-1" } });
  });

  it("suspends a modeled timer without creating an in-process clock and resumes on a durable signal", async () => {
    const timerSource = source.replace(
      '<bpmn:userTask id="approve" name="Approve request" />',
      '<bpmn:intermediateCatchEvent id="approve" name="Wait for cooling off"><bpmn:timerEventDefinition><bpmn:timeDuration>PT30S</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
    );
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "f".repeat(64),
      source: timerSource,
      variables: { requestId: "REQ-TIMER" },
    });
    expect(waiting.waits).toEqual([expect.objectContaining({
      kind: "TIMER",
      elementId: "approve",
      timerBinding: { timerType: "DURATION", expression: "PT30S", durationMilliseconds: 30_000, dueAt: null },
    })]);
    const wait = waiting.waits[0];
    if (wait?.kind !== "TIMER") throw new Error("Expected a timer wait.");
    const completed = await adapter.resume({
      instanceId: crypto.randomUUID(),
      deploymentHash: "f".repeat(64),
      source: timerSource,
      variables: waiting.variables,
      envelope: waiting.envelope,
      signal: { executionId: wait.executionId, output: {} },
    });
    expect(completed).toMatchObject({ status: "COMPLETED", waits: [] });
  });

  it("suspends a message catch as a Wanaflow subscription and resumes only from an external signal", async () => {
    const messageSource = source
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:process id="approval" name="Simple approval" isExecutable="true">',
        '<bpmn:message id="Message_order_approved" name="order.approved" /><bpmn:process id="approval" name="Simple approval" isExecutable="true">',
      )
      .replace(
        '<bpmn:userTask id="approve" name="Approve request" />',
        '<bpmn:intermediateCatchEvent id="approve" name="Wait for approval" wanaflow:correlationKey="orderId"><bpmn:messageEventDefinition messageRef="Message_order_approved" /></bpmn:intermediateCatchEvent>',
      );
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "1".repeat(64),
      source: messageSource,
      variables: { orderId: "ORD-42" },
    });
    expect(waiting.waits).toEqual([expect.objectContaining({
      kind: "MESSAGE",
      elementId: "approve",
      messageBinding: { messageName: "order.approved", correlationKeyVariable: "orderId" },
    })]);
    const wait = waiting.waits[0];
    if (wait?.kind !== "MESSAGE") throw new Error("Expected a message wait.");
    const completed = await adapter.resume({
      instanceId: crypto.randomUUID(),
      deploymentHash: "1".repeat(64),
      source: messageSource,
      variables: waiting.variables,
      envelope: waiting.envelope,
      signal: { executionId: wait.executionId, output: { approvalRef: "APP-9" } },
    });
    expect(completed).toMatchObject({ status: "COMPLETED", variables: { orderId: "ORD-42", approvalRef: "APP-9" } });
  });

  it("captures a message throw as one durable delivery without using the engine-local broker", async () => {
    const messageSource = source
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace(
        '<bpmn:process id="approval" name="Simple approval" isExecutable="true">',
        '<bpmn:message id="Message_order_approved" name="order.approved" /><bpmn:process id="approval" name="Simple approval" isExecutable="true">',
      )
      .replace(
        '<bpmn:userTask id="approve" name="Approve request" />',
        '<bpmn:intermediateThrowEvent id="approve" name="Send approval" wanaflow:correlationKey="orderId" wanaflow:messagePayloadMapping="{&quot;approvalRef&quot;:&quot;approvalRef&quot;}"><bpmn:messageEventDefinition messageRef="Message_order_approved" /></bpmn:intermediateThrowEvent>',
      );
    const completed = await new BpmnEngineAdapter().start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "2".repeat(64),
      source: messageSource,
      variables: { orderId: "ORD-42", approvalRef: "APP-42" },
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      waits: [],
      messageDeliveries: [{
        elementId: "approve",
        elementName: "Send approval",
        messageBinding: {
          messageName: "order.approved",
          correlationKeyVariable: "orderId",
          payloadMapping: { approvalRef: "approvalRef" },
        },
      }],
    });
  });

  it("evaluates a pinned DMN table after recovery and returns durable evidence", async () => {
    const decisionProcess = source
      .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
      .replace('<bpmn:endEvent id="end" name="Request approved" />', '<bpmn:businessRuleTask id="route" name="Route invoice" wanaflow:decisionKey="invoice-route" wanaflow:decisionInputMapping="{&quot;amount&quot;:&quot;invoiceAmount&quot;}" wanaflow:decisionOutputMapping="{&quot;isApproved&quot;:&quot;approved&quot;}" /><bpmn:endEvent id="end" name="Request approved" />')
      .replace('<bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />', '<bpmn:sequenceFlow id="to-route" sourceRef="approve" targetRef="route" /><bpmn:sequenceFlow id="to-end" sourceRef="route" targetRef="end" />');
    const decisions = [{
      key: "invoice-route",
      artifactVersionId: crypto.randomUUID(),
      contentSha256: "d".repeat(64),
      source: decisionSource,
    }];
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: crypto.randomUUID(),
      deploymentHash: "3".repeat(64),
      source: decisionProcess,
      variables: { invoiceAmount: 700 },
      decisions,
    });
    const completed = await adapter.resume({
      instanceId: crypto.randomUUID(),
      deploymentHash: "3".repeat(64),
      source: decisionProcess,
      variables: waiting.variables,
      envelope: waiting.envelope,
      signal: { executionId: waiting.waits[0].executionId, output: {} },
      decisions,
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.variables).toMatchObject({ invoiceAmount: 700, isApproved: true });
    expect(completed.decisionEvaluations).toEqual([expect.objectContaining({
      elementId: "route",
      decisionKey: "invoice-route",
      decisionName: "Invoice route",
      matchedRuleIds: ["Rule_auto"],
      input: { amount: 700 },
      output: { approved: true },
    })]);
  });
});
