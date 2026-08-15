import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BpmnEngineAdapter } from "@wanaflow/runtime";

import {
  claimNextRuntimeWork,
  claimNextMessageDelivery,
  acceptNextDueTimer,
  assertRuntimeClaimProjection,
  cancelProcessInstance,
  commitRuntimeWork,
  correlateMessage,
  dispatchClaimedMessageDelivery,
  completeExternalJob,
  completeProcessTask,
  createWorkerCredential,
  createArtifact,
  createPublication,
  createReview,
  decideReview,
  deployPublication,
  ensureLocalSetup,
  evaluateDecision,
  getPool,
  getProcessInstance,
  heartbeatExternalJob,
  authenticateJobWorkerToken,
  failExternalJob,
  listExternalJobs,
  listMyTasks,
  listTaskAssigneeCandidates,
  listMessageSubscriptions,
  listMessageDeliveries,
  listProjectEnvironments,
  listProcessTimers,
  rolePermissions,
  retryExternalJob,
  revokeWorkerCredential,
  lockExternalJobs,
  startProcessInstance,
  simulateArtifactDraft,
  updateProcessTaskAssignment,
} from "./index";
import { closePool } from "./pool";
import { runMigrations } from "./migrate";
import type { PrincipalContext } from "./types";

const source = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://wanaflow.dev/runtime-test">
  <bpmn:process id="expense-approval" name="Expense approval" isExecutable="true">
    <bpmn:startEvent id="start" name="Expense submitted" />
    <bpmn:userTask id="approve" name="Approve expense" />
    <bpmn:endEvent id="end" name="Expense approved" />
    <bpmn:sequenceFlow id="to-approve" sourceRef="start" targetRef="approve" />
    <bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

const boundSource = source
  .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
  .replace(
    '<bpmn:userTask id="approve" name="Approve expense" />',
    '<bpmn:userTask id="approve" name="Approve expense" wanaflow:formKey="expense-decision" wanaflow:inputMapping="{&quot;amount&quot;:&quot;amount&quot;}" wanaflow:outputMapping="{&quot;decision&quot;:&quot;decision&quot;}" />',
  );

const jobSource = source
  .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
  .replace(
    '<bpmn:userTask id="approve" name="Approve expense" />',
    '<bpmn:serviceTask id="approve" name="Send expense" wanaflow:jobType="expense.send" wanaflow:jobInputMapping="{&quot;amount&quot;:&quot;amount&quot;}" wanaflow:jobOutputMapping="{&quot;receiptId&quot;:&quot;receipt&quot;}" wanaflow:jobHeaders="{&quot;region&quot;:&quot;west&quot;}" wanaflow:jobLockDuration="PT30S" wanaflow:jobMaxAttempts="2" wanaflow:jobRetryBackoff="PT1S" />',
  );

const timerSource = source.replace(
  '<bpmn:userTask id="approve" name="Approve expense" />',
  '<bpmn:intermediateCatchEvent id="approve" name="Wait until review window closes"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>',
);
const dueTimerSource = timerSource.replace("PT1H", "PT0S");

const messageSource = source
  .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
  .replace(
    '<bpmn:process id="expense-approval" name="Expense approval" isExecutable="true">',
    '<bpmn:message id="Message_expense_approved" name="expense.approved" /><bpmn:process id="expense-approval" name="Expense approval" isExecutable="true">',
  )
  .replace(
    '<bpmn:userTask id="approve" name="Approve expense" />',
    '<bpmn:intermediateCatchEvent id="approve" name="Wait for approval" wanaflow:correlationKey="expenseId"><bpmn:messageEventDefinition messageRef="Message_expense_approved" /></bpmn:intermediateCatchEvent>',
  );

const messageThrowAndCatchSource = source
  .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
  .replace(
    '<bpmn:process id="expense-approval" name="Expense approval" isExecutable="true">',
    '<bpmn:message id="Message_expense_approved" name="expense.approved" /><bpmn:process id="expense-approval" name="Expense approval" isExecutable="true">',
  )
  .replace(
    '<bpmn:userTask id="approve" name="Approve expense" />',
    '<bpmn:intermediateThrowEvent id="send" name="Send approval" wanaflow:correlationKey="expenseId" wanaflow:messagePayloadMapping="{&quot;approvalRef&quot;:&quot;approvalRef&quot;}"><bpmn:messageEventDefinition messageRef="Message_expense_approved" /></bpmn:intermediateThrowEvent>\n    <bpmn:intermediateCatchEvent id="approve" name="Wait for approval" wanaflow:correlationKey="expenseId"><bpmn:messageEventDefinition messageRef="Message_expense_approved" /></bpmn:intermediateCatchEvent>',
  )
  .replace('sourceRef="start" targetRef="approve"', 'sourceRef="start" targetRef="send"')
  .replace(
    '<bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />',
    '<bpmn:sequenceFlow id="to-catch" sourceRef="send" targetRef="approve" />\n    <bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />',
  );

const formSource = JSON.stringify({
  schemaVersion: 19,
  type: "default",
  id: "expense-decision",
  components: [
    { id: "amount", type: "number", key: "amount", label: "Amount" },
    { id: "decision", type: "textfield", key: "decision", label: "Decision", validate: { required: true } },
  ],
});

const dmnSource = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="Definitions_expense_route" namespace="https://wanaflow.dev/test">
  <decision id="Decision_expense_route" name="Expense route">
    <decisionTable id="Table_expense_route" hitPolicy="UNIQUE">
      <input id="Input_amount" label="Amount"><inputExpression id="Expr_amount" typeRef="number"><text>amount</text></inputExpression></input>
      <output id="Output_route" name="route" label="Route" typeRef="string" />
      <rule id="Rule_auto"><inputEntry id="InputEntry_auto"><text>&lt;= 1000</text></inputEntry><outputEntry id="OutputEntry_auto"><text>"automatic"</text></outputEntry></rule>
      <rule id="Rule_manual"><inputEntry id="InputEntry_manual"><text>&gt; 1000</text></inputEntry><outputEntry id="OutputEntry_manual"><text>"manual"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`;

const decisionProcessSource = source
  .replace("xmlns:bpmn=", 'xmlns:wanaflow="https://wanaflow.dev/schema/bpmn" xmlns:bpmn=')
  .replace('<bpmn:endEvent id="end" name="Expense approved" />', '<bpmn:businessRuleTask id="route" name="Choose expense route" wanaflow:decisionKey="expense-route" wanaflow:decisionInputMapping="{&quot;amount&quot;:&quot;amount&quot;}" wanaflow:decisionOutputMapping="{&quot;expenseRoute&quot;:&quot;route&quot;}" /><bpmn:endEvent id="end" name="Expense approved" />')
  .replace('<bpmn:sequenceFlow id="to-end" sourceRef="approve" targetRef="end" />', '<bpmn:sequenceFlow id="to-route" sourceRef="approve" targetRef="route" /><bpmn:sequenceFlow id="to-end" sourceRef="route" targetRef="end" />');

async function fixture(withForm = false, processSource?: string) {
  const setup = await ensureLocalSetup({
    organizationKey: "local",
    workspaceKey: "default",
    projectKey: "operations",
    artifactSource: processSource ?? (withForm ? boundSource : source),
  });
  await getPool().query(
    `INSERT INTO organization_memberships (organization_id, principal_id, role)
     VALUES ($1, $2, 'organization-owner')`,
    [setup.organization.id, setup.principal.id],
  );
  const reviewer = await getPool().query<{ id: string; email: string; display_name: string }>(
    `INSERT INTO principals (organization_id, email, display_name)
     VALUES ($1, 'runtime-reviewer@example.com', 'Runtime Reviewer')
     RETURNING id, email, display_name`,
    [setup.organization.id],
  );
  await getPool().query(
    `INSERT INTO organization_memberships (organization_id, principal_id, role)
     VALUES ($1, $2, 'reviewer')`,
    [setup.organization.id, reviewer.rows[0].id],
  );
  const ownerContext: PrincipalContext = {
    organization: setup.organization,
    principal: setup.principal,
    role: "organization-owner",
    workspaceScopeId: null,
    permissions: rolePermissions["organization-owner"],
  };
  const reviewerContext: PrincipalContext = {
    organization: setup.organization,
    principal: {
      id: reviewer.rows[0].id,
      organizationId: setup.organization.id,
      email: reviewer.rows[0].email,
      displayName: reviewer.rows[0].display_name,
    },
    role: "reviewer",
    workspaceScopeId: null,
    permissions: rolePermissions.reviewer,
  };
  if (withForm) {
    await createArtifact({
      organizationId: setup.organization.id,
      projectId: setup.project.id,
      principalId: setup.principal.id,
      key: "expense-decision",
      name: "Expense decision",
      type: "FORM",
      source: formSource,
    });
  }
  if ((processSource ?? "").includes('wanaflow:decisionKey="expense-route"')) {
    await createArtifact({
      organizationId: setup.organization.id,
      projectId: setup.project.id,
      principalId: setup.principal.id,
      key: "expense-route",
      name: "Expense route",
      type: "DMN_DECISION",
      source: dmnSource,
    });
  }
  const review = await createReview(ownerContext, {
    artifactId: setup.artifact.id,
    revisionId: setup.artifact.revision.id,
    reviewerIds: [reviewerContext.principal.id],
    summary: "Runtime release",
  });
  await decideReview(reviewerContext, review.id, { outcome: "APPROVED" });
  const publication = await createPublication(ownerContext, review.id);
  const environments = await listProjectEnvironments(ownerContext, setup.project.id);
  const deployment = await deployPublication(ownerContext, {
    environmentId: environments.find((environment) => environment.key === "development")!.id,
    publicationId: publication.id,
    note: "Runtime test",
  });
  return { ownerContext, deployment, publication };
}

async function externalJobFixture() {
  const release = await fixture(false, jobSource);
  const accepted = await startProcessInstance(release.ownerContext, {
    deploymentId: release.deployment.id,
    businessKey: "expense:worker",
    variables: { amount: 8900, privateNote: "stays in process" },
  });
  const claim = await claimNextRuntimeWork("runtime-job-fixture", 30);
  const waiting = await new BpmnEngineAdapter().start({
    instanceId: claim!.instanceId,
    deploymentHash: claim!.deploymentHash,
    source: claim!.source,
    variables: claim!.variables,
  });
  expect(await commitRuntimeWork(claim!, waiting)).toBe(true);
  const credential = await createWorkerCredential(release.ownerContext, {
    projectId: release.publication.projectId,
    name: "Expense worker test",
  });
  const workerContext = await authenticateJobWorkerToken(credential.token);
  return { ...release, accepted, credential, workerContext };
}

describe("durable process runtime", () => {
  beforeAll(runMigrations);

  beforeEach(async () => {
    await getPool().query(`
      TRUNCATE deployments, artifact_versions, publications, environments,
        review_decisions, review_comments, review_assignments, reviews,
        outbox_events, audit_records, artifact_revisions, artifacts,
        organization_memberships, projects, principals, workspaces, organizations,
        "session", "account", "verification", "user" CASCADE
    `);
  });

  afterAll(async () => {
    await getPool().query(`
      TRUNCATE deployments, artifact_versions, publications, environments,
        review_decisions, review_comments, review_assignments, reviews,
        outbox_events, audit_records, artifact_revisions, artifacts,
        organization_memberships, projects, principals, workspaces, organizations,
        "session", "account", "verification", "user" CASCADE
    `);
    await closePool();
  });

  it("starts only from a deployment, fences a stale worker, recovers a wait, and completes", async () => {
    const { ownerContext, deployment } = await fixture();
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:42",
      variables: { amount: 125000, currency: "XOF" },
      idempotencyKey: "start:expense:42",
    });
    expect(accepted).toMatchObject({ status: "STARTING", revision: 0, deploymentId: deployment.id });

    const staleClaim = await claimNextRuntimeWork("worker-a", 0);
    expect(staleClaim).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const currentClaim = await claimNextRuntimeWork("worker-b", 30);
    expect(currentClaim).toMatchObject({ instanceId: accepted.id, fencingToken: 2 });

    const adapter = new BpmnEngineAdapter();
    const startResult = await adapter.start({
      instanceId: currentClaim!.instanceId,
      deploymentHash: currentClaim!.deploymentHash,
      source: currentClaim!.source,
      variables: currentClaim!.variables,
    });
    expect(await commitRuntimeWork(staleClaim!, startResult)).toBe(false);
    expect(await commitRuntimeWork(currentClaim!, startResult)).toBe(true);

    const waiting = await getProcessInstance(ownerContext, accepted.id);
    expect(waiting).toMatchObject({ status: "WAITING", revision: 1 });
    expect(waiting.checkpoint?.projectionSha256).toMatch(/^[a-f0-9]{64}$/);
    const tasks = await listMyTasks(ownerContext);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ elementId: "approve", completionPending: false });

    const completion = await completeProcessTask(ownerContext, tasks[0].id, {
      output: { approved: true, note: "Within policy" },
      idempotencyKey: "complete:expense:42",
    });
    expect(completion.task).toMatchObject({ status: "OPEN", completionPending: true });
    const physicalTask = await getPool().query<{ status: string }>(
      "SELECT status FROM process_tasks WHERE id = $1",
      [tasks[0].id],
    );
    expect(physicalTask.rows[0].status).toBe("OPEN");

    const resumeClaim = await claimNextRuntimeWork("worker-after-restart", 30);
    expect(resumeClaim?.envelope).not.toBeNull();
    const resumed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetTask!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, resumed)).toBe(true);

    const completed = await getProcessInstance(ownerContext, accepted.id);
    expect(completed).toMatchObject({
      status: "COMPLETED",
      revision: 2,
      variables: { amount: 125000, currency: "XOF", approved: true, note: "Within policy" },
    });
    expect(completed.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["PROCESS_STARTED", "TASK_AVAILABLE", "TASK_COMPLETED", "PROCESS_COMPLETED"]),
    );
    expect(await listMyTasks(ownerContext)).toEqual([]);
  });

  it("previews a saved draft without creating a production instance", async () => {
    const { ownerContext, publication } = await fixture();
    const version = publication.artifactVersions.find((entry) => entry.artifact.type === "BPMN_PROCESS")!;
    const first = await simulateArtifactDraft(ownerContext, {
      artifactId: version.artifact.id,
      revisionId: version.revisionId,
      variables: { amount: 125000 },
    });
    expect(first).toMatchObject({ status: "WAITING", waits: [{ kind: "USER_TASK", elementId: "approve" }] });
    const finished = await simulateArtifactDraft(ownerContext, {
      artifactId: version.artifact.id,
      revisionId: version.revisionId,
      variables: first.variables,
      envelope: first.envelope,
      signal: { executionId: first.waits[0].executionId, output: { approved: true } },
    });
    expect(finished.status).toBe("COMPLETED");
    const instances = await getPool().query<{ count: string }>("SELECT count(*) FROM process_instances");
    expect(instances.rows[0].count).toBe("0");
  });

  it("keeps task handoffs, due dates, priority, and assignment history durable", async () => {
    const { ownerContext, deployment } = await fixture();
    await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:handoff",
      variables: { amount: 45000 },
    });
    const claim = await claimNextRuntimeWork("handoff-worker", 30);
    const result = await new BpmnEngineAdapter().start({
      instanceId: claim!.instanceId,
      deploymentHash: claim!.deploymentHash,
      source: claim!.source,
      variables: claim!.variables,
    });
    expect(await commitRuntimeWork(claim!, result)).toBe(true);
    const task = (await listMyTasks(ownerContext))[0];
    const delegate = await getPool().query<{ id: string; email: string; display_name: string }>(
      `INSERT INTO principals (organization_id, email, display_name)
       VALUES ($1, 'delegate@example.com', 'Aminata Delegate')
       RETURNING id, email, display_name`,
      [ownerContext.organization.id],
    );
    await getPool().query(
      `INSERT INTO organization_memberships (organization_id, principal_id, role)
       VALUES ($1, $2, 'task-worker')`,
      [ownerContext.organization.id, delegate.rows[0].id],
    );
    expect(await listTaskAssigneeCandidates(ownerContext, task.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: delegate.rows[0].id })]),
    );
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const updated = await updateProcessTaskAssignment(ownerContext, task.id, {
      assigneeId: delegate.rows[0].id,
      dueAt,
      priority: "HIGH",
      note: "Please take the final review.",
    });
    expect(updated).toMatchObject({
      assignee: { id: delegate.rows[0].id },
      priority: "HIGH",
      delegatedFrom: { id: ownerContext.principal.id },
      assignmentHistory: [expect.objectContaining({ note: "Please take the final review." })],
    });
    expect(updated.dueAt).toBe(dueAt);
    expect(await listMyTasks(ownerContext)).toHaveLength(0);
    const delegateContext: PrincipalContext = {
      organization: ownerContext.organization,
      principal: {
        id: delegate.rows[0].id,
        organizationId: ownerContext.organization.id,
        email: delegate.rows[0].email,
        displayName: delegate.rows[0].display_name,
      },
      role: "task-worker",
      workspaceScopeId: null,
      permissions: rolePermissions["task-worker"],
    };
    expect(await listMyTasks(delegateContext)).toEqual([
      expect.objectContaining({ id: task.id, dueAt, priority: "HIGH" }),
    ]);
  });

  it("schedules, accepts, and recovers a PostgreSQL-owned timer exactly once", async () => {
    const { ownerContext, deployment } = await fixture(false, dueTimerSource);
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:timer",
      variables: { amount: 4200 },
    });
    const startClaim = await claimNextRuntimeWork("timer-start", 30);
    const waitingResult = await new BpmnEngineAdapter().start({
      instanceId: startClaim!.instanceId,
      deploymentHash: startClaim!.deploymentHash,
      source: startClaim!.source,
      variables: startClaim!.variables,
    });
    expect(waitingResult.waits[0]).toMatchObject({ kind: "TIMER", elementId: "approve" });
    expect(await commitRuntimeWork(startClaim!, waitingResult)).toBe(true);

    const [timer] = await listProcessTimers(ownerContext, { instanceId: accepted.id });
    expect(timer).toMatchObject({
      status: "WAITING",
      timerType: "DURATION",
      expression: "PT0S",
      durationMilliseconds: 0,
      completionPending: false,
    });
    const firing = await acceptNextDueTimer();
    expect(firing).toMatchObject({ timerId: timer.id, instanceId: accepted.id });
    expect(await acceptNextDueTimer()).toBeNull();
    expect((await listProcessTimers(ownerContext, { instanceId: accepted.id }))[0])
      .toMatchObject({ status: "WAITING", completionPending: true });
    await expect(cancelProcessInstance(ownerContext, accepted.id, { reason: "too late" }))
      .rejects.toThrow("accepted command");

    const resumeClaim = await claimNextRuntimeWork("timer-after-restart", 30);
    expect(resumeClaim).toMatchObject({ commandType: "TIMER_FIRE", targetTimer: { id: timer.id } });
    await expect(assertRuntimeClaimProjection(resumeClaim!)).resolves.toBeUndefined();
    const completed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetTimer!.executionId, output: {} },
    });
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(true);

    const instance = await getProcessInstance(ownerContext, accepted.id);
    expect(instance.status).toBe("COMPLETED");
    expect(instance.timers[0]).toMatchObject({ status: "FIRED", completionPending: false });
    expect(instance.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "TIMER_SCHEDULED",
      "TIMER_FIRED",
      "PROCESS_COMPLETED",
    ]));
  });

  it("lets cancellation beat a future timer without mutating the last checkpoint", async () => {
    const { ownerContext, deployment } = await fixture(false, timerSource);
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:cancel-timer",
    });
    const claim = await claimNextRuntimeWork("timer-cancel", 30);
    const result = await new BpmnEngineAdapter().start({
      instanceId: claim!.instanceId,
      deploymentHash: claim!.deploymentHash,
      source: claim!.source,
      variables: claim!.variables,
    });
    expect(await commitRuntimeWork(claim!, result)).toBe(true);
    const before = await getProcessInstance(ownerContext, accepted.id);
    const projection = before.checkpoint!.projectionSha256;
    await cancelProcessInstance(ownerContext, accepted.id, { reason: "request withdrawn" });
    await getPool().query("UPDATE process_timers SET due_at = now() WHERE instance_id = $1", [accepted.id]);
    expect(await acceptNextDueTimer()).toBeNull();
    const cancelled = await getProcessInstance(ownerContext, accepted.id);
    expect(cancelled).toMatchObject({ status: "CANCELLED", checkpoint: { projectionSha256: projection } });
    expect(cancelled.timers[0]).toMatchObject({ status: "CANCELLED", completionPending: false });
    const physical = await getPool().query<{ status: string }>(
      "SELECT status FROM process_timers WHERE instance_id = $1",
      [accepted.id],
    );
    expect(physical.rows[0].status).toBe("WAITING");
  });

  it("durably correlates exactly one message subscription with replay-safe no-match outcomes", async () => {
    const { ownerContext, deployment } = await fixture(false, messageSource);
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:message",
      variables: { expenseId: "EXP-42", amount: 4200 },
    });
    const startClaim = await claimNextRuntimeWork("message-start", 30);
    const waiting = await new BpmnEngineAdapter().start({
      instanceId: startClaim!.instanceId,
      deploymentHash: startClaim!.deploymentHash,
      source: startClaim!.source,
      variables: startClaim!.variables,
    });
    expect(waiting.waits[0]).toMatchObject({
      kind: "MESSAGE",
      messageBinding: { messageName: "expense.approved", correlationKeyVariable: "expenseId" },
    });
    expect(await commitRuntimeWork(startClaim!, waiting)).toBe(true);

    const [subscription] = await listMessageSubscriptions(ownerContext, { instanceId: accepted.id });
    expect(subscription).toMatchObject({
      status: "WAITING",
      messageName: "expense.approved",
      correlationKey: "EXP-42",
      completionPending: false,
    });
    const noMatch = await correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-OTHER",
      payload: { approvalRef: "APP-none" },
      idempotencyKey: "message:no-match",
    });
    expect(noMatch).toMatchObject({ outcome: "NO_MATCH", commandId: null, subscription: null });
    const noMatchReplay = await correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-OTHER",
      payload: { approvalRef: "APP-none" },
      idempotencyKey: "message:no-match",
    });
    expect(noMatchReplay.attemptId).toBe(noMatch.attemptId);
    await expect(correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-OTHER",
      payload: { approvalRef: "changed" },
      idempotencyKey: "message:no-match",
    })).rejects.toMatchObject({ name: "RuntimeStateConflictError" });

    const correlated = await correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-42",
      payload: { approvalRef: "APP-42" },
      idempotencyKey: "message:EXP-42",
    });
    expect(correlated).toMatchObject({
      outcome: "CORRELATED",
      subscription: { id: subscription.id, status: "WAITING", completionPending: true },
    });
    await expect(correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-42",
      payload: { approvalRef: "APP-too-late" },
      idempotencyKey: "message:EXP-42:loser",
    })).rejects.toMatchObject({ name: "RuntimeStateConflictError" });
    const physical = await getPool().query<{ status: string }>(
      "SELECT status FROM message_subscriptions WHERE id = $1",
      [subscription.id],
    );
    expect(physical.rows[0].status).toBe("WAITING");
    await expect(cancelProcessInstance(ownerContext, accepted.id)).rejects.toThrow("accepted command");

    const resumeClaim = await claimNextRuntimeWork("message-after-restart", 30);
    expect(resumeClaim).toMatchObject({
      commandType: "MESSAGE_CORRELATE",
      targetSubscription: { id: subscription.id },
      output: { approvalRef: "APP-42" },
    });
    await expect(assertRuntimeClaimProjection(resumeClaim!)).resolves.toBeUndefined();
    const completed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetSubscription!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(true);
    const instance = await getProcessInstance(ownerContext, accepted.id);
    expect(instance).toMatchObject({
      status: "COMPLETED",
      variables: { expenseId: "EXP-42", amount: 4200, approvalRef: "APP-42" },
      messageSubscriptions: [expect.objectContaining({ status: "CONSUMED", payload: { approvalRef: "APP-42" } })],
    });
    expect(instance.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "MESSAGE_SUBSCRIBED",
      "MESSAGE_CORRELATED",
      "PROCESS_COMPLETED",
    ]));
  });

  it("rejects ambiguous message correlation without consuming either subscription", async () => {
    const { ownerContext, deployment } = await fixture(false, messageSource);
    for (const businessKey of ["expense:ambiguous:1", "expense:ambiguous:2"]) {
      await startProcessInstance(ownerContext, {
        deploymentId: deployment.id,
        businessKey,
        variables: { expenseId: "EXP-SHARED" },
      });
      const claim = await claimNextRuntimeWork(`message-${businessKey}`, 30);
      const waiting = await new BpmnEngineAdapter().start({
        instanceId: claim!.instanceId,
        deploymentHash: claim!.deploymentHash,
        source: claim!.source,
        variables: claim!.variables,
      });
      expect(await commitRuntimeWork(claim!, waiting)).toBe(true);
    }
    const correlation = await correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: "expense.approved",
      correlationKey: "EXP-SHARED",
      payload: { approvalRef: "APP-shared" },
      idempotencyKey: "message:ambiguous",
    });
    expect(correlation).toMatchObject({ outcome: "AMBIGUOUS", commandId: null, subscription: null });
    const subscriptions = await listMessageSubscriptions(ownerContext);
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.every((entry) => entry.status === "WAITING" && !entry.completionPending)).toBe(true);
  });

  it("commits a message throw with its checkpoint and replays dispatch after a post-correlation crash", async () => {
    const { ownerContext, deployment } = await fixture(false, messageThrowAndCatchSource);
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:message-delivery",
      variables: { expenseId: "EXP-DELIVERY", approvalRef: "APP-DELIVERY" },
    });
    const startClaim = await claimNextRuntimeWork("message-delivery-start", 30);
    const waiting = await new BpmnEngineAdapter().start({
      instanceId: startClaim!.instanceId,
      deploymentHash: startClaim!.deploymentHash,
      source: startClaim!.source,
      variables: startClaim!.variables,
    });
    expect(waiting).toMatchObject({
      status: "WAITING",
      waits: [expect.objectContaining({ kind: "MESSAGE", elementId: "approve" })],
      messageDeliveries: [expect.objectContaining({
        elementId: "send",
        messageBinding: expect.objectContaining({ messageName: "expense.approved", correlationKeyVariable: "expenseId" }),
      })],
    });
    expect(await commitRuntimeWork(startClaim!, waiting)).toBe(true);

    const checkpointBeforeDispatch = (await getProcessInstance(ownerContext, accepted.id)).checkpoint!.projectionSha256;
    const [delivery] = await listMessageDeliveries(ownerContext, { instanceId: accepted.id });
    const [subscription] = await listMessageSubscriptions(ownerContext, { instanceId: accepted.id });
    expect(delivery).toMatchObject({
      status: "AVAILABLE",
      messageName: "expense.approved",
      correlationKey: "EXP-DELIVERY",
      payload: { approvalRef: "APP-DELIVERY" },
      attempts: 0,
    });

    const abandoned = await claimNextMessageDelivery("delivery-before-crash", 30);
    expect(abandoned).toMatchObject({ id: delivery.id, fencingToken: 1, attempts: 1 });
    const correlatedBeforeCrash = await correlateMessage(ownerContext, {
      environmentId: deployment.environmentId,
      messageName: abandoned!.messageName,
      correlationKey: abandoned!.correlationKey,
      payload: abandoned!.payload,
      idempotencyKey: `message-delivery:${abandoned!.id}`,
    });
    expect(correlatedBeforeCrash).toMatchObject({ outcome: "CORRELATED", subscription: { id: subscription.id } });
    await getPool().query(
      "UPDATE message_deliveries SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [delivery.id],
    );

    const replacement = await claimNextMessageDelivery("delivery-after-crash", 30);
    expect(replacement).toMatchObject({ id: delivery.id, fencingToken: 2, attempts: 2 });
    const dispatched = await dispatchClaimedMessageDelivery(replacement!);
    expect(dispatched).toMatchObject({ handled: true, settled: true, outcome: "CORRELATED" });
    const [delivered] = await listMessageDeliveries(ownerContext, { instanceId: accepted.id });
    expect(delivered).toMatchObject({
      status: "DELIVERED",
      attempts: 2,
      correlationAttemptId: correlatedBeforeCrash.attemptId,
      targetSubscriptionId: subscription.id,
    });
    const commandCount = await getPool().query<{ count: string }>(
      "SELECT count(*) FROM runtime_commands WHERE target_subscription_id = $1",
      [subscription.id],
    );
    expect(commandCount.rows[0].count).toBe("1");
    const attemptCount = await getPool().query<{ count: string }>(
      "SELECT count(*) FROM message_correlation_attempts WHERE idempotency_key = $1",
      [`message-delivery:${delivery.id}`],
    );
    expect(attemptCount.rows[0].count).toBe("1");
    expect((await getProcessInstance(ownerContext, accepted.id)).checkpoint!.projectionSha256)
      .toBe(checkpointBeforeDispatch);

    const resumeClaim = await claimNextRuntimeWork("message-delivery-resume", 30);
    const completed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetSubscription!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(true);
    const instance = await getProcessInstance(ownerContext, accepted.id);
    expect(instance).toMatchObject({
      status: "COMPLETED",
      messageSubscriptions: [expect.objectContaining({ status: "CONSUMED" })],
      messageDeliveries: [expect.objectContaining({ status: "DELIVERED" })],
    });
    expect(instance.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "MESSAGE_QUEUED",
      "MESSAGE_SUBSCRIBED",
      "MESSAGE_CORRELATED",
      "PROCESS_COMPLETED",
    ]));
  });

  it("returns the same instance for a repeated start idempotency key", async () => {
    const { ownerContext, deployment } = await fixture();
    const first = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      idempotencyKey: "stable-start",
    });
    const repeated = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      idempotencyKey: "stable-start",
    });
    expect(repeated.id).toBe(first.id);
    await expect(
      startProcessInstance(ownerContext, {
        deploymentId: deployment.id,
        idempotencyKey: "stable-start",
        variables: { changed: true },
      }),
    ).rejects.toMatchObject({ name: "RuntimeStateConflictError" });
    const count = await getPool().query<{ count: string }>("SELECT count(*) FROM process_instances");
    expect(count.rows[0].count).toBe("1");
  });

  it("pins a form in the publication, validates submissions, and applies only explicit outputs", async () => {
    const { ownerContext, deployment, publication } = await fixture(true);
    expect(publication.artifactVersions).toHaveLength(2);
    expect(publication.manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "expense-decision", type: "FORM" }),
    ]));
    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      variables: { amount: 42000, internalOnly: "kept" },
    });
    const claim = await claimNextRuntimeWork("form-worker", 30);
    const waiting = await new BpmnEngineAdapter().start({
      instanceId: claim!.instanceId,
      deploymentHash: claim!.deploymentHash,
      source: claim!.source,
      variables: claim!.variables,
    });
    expect(await commitRuntimeWork(claim!, waiting)).toBe(true);

    const [task] = await listMyTasks(ownerContext);
    expect(task.form).toMatchObject({
      key: "expense-decision",
      data: { amount: 42000 },
    });
    expect(task.form?.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(completeProcessTask(ownerContext, task.id, { output: {} })).rejects.toMatchObject({
      code: "FORM_SUBMISSION_INVALID",
    });
    await expect(completeProcessTask(ownerContext, task.id, {
      output: { amount: 1, decision: "approved", untrusted: "ignored" },
    })).rejects.toMatchObject({ code: "FORM_SUBMISSION_INVALID" });
    await completeProcessTask(ownerContext, task.id, {
      output: { amount: 1, decision: "approved" },
    });
    const resumeClaim = await claimNextRuntimeWork("form-worker", 30);
    expect(resumeClaim?.output).toEqual({ decision: "approved" });
    const completed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetTask!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(true);
    expect(await getProcessInstance(ownerContext, accepted.id)).toMatchObject({
      variables: { amount: 42000, internalOnly: "kept", decision: "approved" },
    });
  });

  it("locks an external job, fences stale delivery calls, deduplicates completion, and resumes", async () => {
    const { ownerContext, accepted, workerContext } = await externalJobFixture();
    const before = await getProcessInstance(ownerContext, accepted.id);
    const [locked] = await lockExternalJobs(workerContext, { workerId: "sdk-a", jobTypes: ["expense.send"] });
    expect(locked).toMatchObject({
      input: { amount: 8900 },
      headers: { region: "west" },
      attempt: 1,
      cycleAttempt: 1,
      fencingToken: 1,
    });
    const renewed = await heartbeatExternalJob(workerContext, locked.id, {
      deliveryId: locked.deliveryId,
      workerId: "sdk-a",
      fencingToken: locked.fencingToken,
    });
    expect(renewed.fencingToken).toBe(2);
    await expect(completeExternalJob(workerContext, locked.id, {
      deliveryId: locked.deliveryId,
      workerId: "sdk-a",
      fencingToken: 1,
      result: { receipt: "R-stale" },
    })).rejects.toMatchObject({ name: "RuntimeStateConflictError" });
    const completion = await completeExternalJob(workerContext, locked.id, {
      deliveryId: locked.deliveryId,
      workerId: "sdk-a",
      fencingToken: renewed.fencingToken,
      result: { receipt: "R-89", ignored: true },
    });
    const repeated = await completeExternalJob(workerContext, locked.id, {
      deliveryId: locked.deliveryId,
      workerId: "sdk-a",
      fencingToken: renewed.fencingToken,
      result: { receipt: "R-89", ignored: true },
    });
    expect(repeated.commandId).toBe(completion.commandId);

    const pending = await getProcessInstance(ownerContext, accepted.id);
    expect(pending).toMatchObject({ status: "WAITING", revision: 1 });
    expect(pending.checkpoint?.projectionSha256).toBe(before.checkpoint?.projectionSha256);
    expect(pending.jobs[0]).toMatchObject({ status: "WAITING", completionPending: true });

    const resumeClaim = await claimNextRuntimeWork("runtime-after-job", 30);
    expect(resumeClaim?.targetJob?.id).toBe(locked.id);
    const resumed = await new BpmnEngineAdapter().resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetJob!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, resumed)).toBe(true);
    expect(await getProcessInstance(ownerContext, accepted.id)).toMatchObject({
      status: "COMPLETED",
      revision: 2,
      variables: { amount: 8900, privateNote: "stays in process", receiptId: "R-89" },
      jobs: [expect.objectContaining({ status: "COMPLETED" })],
    });
  });

  it("keeps retries outside the checkpoint and opens a recoverable incident after exhaustion", async () => {
    const { ownerContext, accepted, workerContext } = await externalJobFixture();
    const checkpointHash = (await getProcessInstance(ownerContext, accepted.id)).checkpoint?.projectionSha256;
    const [first] = await lockExternalJobs(workerContext, { workerId: "sdk-retry", jobTypes: ["expense.send"] });
    await expect(failExternalJob(workerContext, first.id, {
      deliveryId: first.deliveryId,
      workerId: "sdk-retry",
      fencingToken: first.fencingToken,
      code: "REMOTE_503",
      message: "Provider unavailable",
    })).resolves.toMatchObject({ status: "RETRY_SCHEDULED", nextAttempt: 2 });
    await getPool().query("UPDATE external_job_deliveries SET available_at = now() WHERE job_id = $1 AND status = 'AVAILABLE'", [first.id]);
    const [second] = await lockExternalJobs(workerContext, { workerId: "sdk-retry", jobTypes: ["expense.send"] });
    expect(second).toMatchObject({ attempt: 2, cycleAttempt: 2, retryCycle: 1 });
    await expect(failExternalJob(workerContext, second.id, {
      deliveryId: second.deliveryId,
      workerId: "sdk-retry",
      fencingToken: second.fencingToken,
      code: "REMOTE_503",
      message: "Provider still unavailable",
    })).resolves.toMatchObject({ status: "INCIDENT" });

    const incident = await getProcessInstance(ownerContext, accepted.id);
    expect(incident).toMatchObject({ status: "INCIDENT", revision: 1 });
    expect(incident.checkpoint?.projectionSha256).toBe(checkpointHash);
    expect(incident.jobs[0]).toMatchObject({ status: "WAITING", completionPending: false });
    await expect(retryExternalJob(ownerContext, first.id)).resolves.toMatchObject({ attempt: 3, retryCycle: 2 });
    const [retried] = await lockExternalJobs(workerContext, { workerId: "sdk-retry", jobTypes: ["expense.send"] });
    expect(retried).toMatchObject({ attempt: 3, cycleAttempt: 1, retryCycle: 2 });
    expect((await listExternalJobs(ownerContext, { instanceId: accepted.id }))[0].deliveries).toHaveLength(3);
  });

  it("serializes cancellation against a fenced job completion", async () => {
    const { ownerContext, accepted, workerContext } = await externalJobFixture();
    const [locked] = await lockExternalJobs(workerContext, { workerId: "sdk-race", jobTypes: ["expense.send"] });
    const results = await Promise.allSettled([
      cancelProcessInstance(ownerContext, accepted.id, { reason: "Request withdrawn" }),
      completeExternalJob(workerContext, locked.id, {
        deliveryId: locked.deliveryId,
        workerId: "sdk-race",
        fencingToken: locked.fencingToken,
        result: { receipt: "R-race" },
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const instance = await getProcessInstance(ownerContext, accepted.id);
    if (instance.status === "CANCELLED") {
      expect(instance.jobs[0]).toMatchObject({ status: "CANCELLED", completionPending: false });
      expect(instance.jobs[0].deliveries[0].status).toBe("SUPERSEDED");
    } else {
      expect(instance).toMatchObject({ status: "WAITING" });
      expect(instance.jobs[0]).toMatchObject({ status: "WAITING", completionPending: true });
      expect(instance.jobs[0].deliveries[0].status).toBe("SUCCEEDED");
    }
    const pendingCommands = await getPool().query<{ count: string }>(
      `SELECT count(*) FROM runtime_commands
       WHERE instance_id = $1 AND type = 'JOB_COMPLETE' AND status IN ('ACCEPTED', 'CLAIMED')`,
      [accepted.id],
    );
    expect(Number(pendingCommands.rows[0].count)).toBeLessThanOrEqual(1);
  });

  it("stores worker credentials as revocable one-way digests", async () => {
    const { ownerContext, publication } = await fixture();
    const credential = await createWorkerCredential(ownerContext, {
      projectId: publication.projectId,
      name: "One-time worker secret",
    });
    expect(credential.token).toMatch(/^wf_job_/);
    const persisted = await getPool().query<{ token_prefix: string; token_sha256: string }>(
      "SELECT token_prefix, token_sha256 FROM worker_credentials WHERE id = $1",
      [credential.id],
    );
    expect(persisted.rows[0].token_prefix).toBe(credential.token.slice(0, 16));
    expect(persisted.rows[0].token_sha256).not.toContain(credential.token);
    await expect(authenticateJobWorkerToken(credential.token)).resolves.toMatchObject({ projectId: publication.projectId });
    await revokeWorkerCredential(ownerContext, credential.id);
    await expect(authenticateJobWorkerToken(credential.token)).rejects.toMatchObject({ name: "PermissionDeniedError" });
  });

  it("pins DMN, evaluates through API and recovered BPMN, and fences duplicate evidence", async () => {
    const { ownerContext, publication, deployment } = await fixture(false, decisionProcessSource);
    expect(publication.manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "expense-route", type: "DMN_DECISION" }),
    ]));

    const external = await evaluateDecision(ownerContext, {
      deploymentId: deployment.id,
      decisionKey: "expense-route",
      input: { amount: 1500 },
      idempotencyKey: "expense-42-route",
    });
    const replayed = await evaluateDecision(ownerContext, {
      deploymentId: deployment.id,
      decisionKey: "expense-route",
      input: { amount: 1500 },
      idempotencyKey: "expense-42-route",
    });
    expect(replayed.id).toBe(external.id);
    expect(external).toMatchObject({ outcome: "MATCHED", output: { route: "manual" } });
    await expect(evaluateDecision(ownerContext, {
      deploymentId: deployment.id,
      decisionKey: "expense-route",
      input: { amount: 100 },
      idempotencyKey: "expense-42-route",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const accepted = await startProcessInstance(ownerContext, {
      deploymentId: deployment.id,
      businessKey: "expense:decision",
      variables: { amount: 700 },
    });
    const startClaim = await claimNextRuntimeWork("runtime-dmn-start", 30);
    const adapter = new BpmnEngineAdapter();
    const waiting = await adapter.start({
      instanceId: startClaim!.instanceId,
      deploymentHash: startClaim!.deploymentHash,
      source: startClaim!.source,
      variables: startClaim!.variables,
      decisions: startClaim!.decisions,
    });
    expect(await commitRuntimeWork(startClaim!, waiting)).toBe(true);
    const [task] = await listMyTasks(ownerContext);
    await completeProcessTask(ownerContext, task.id, { output: {}, idempotencyKey: "approve-decision" });
    const resumeClaim = await claimNextRuntimeWork("runtime-dmn-resume", 30);
    const completed = await adapter.resume({
      instanceId: resumeClaim!.instanceId,
      deploymentHash: resumeClaim!.deploymentHash,
      source: resumeClaim!.source,
      variables: resumeClaim!.variables,
      decisions: resumeClaim!.decisions,
      envelope: resumeClaim!.envelope!,
      signal: { executionId: resumeClaim!.targetTask!.executionId, output: resumeClaim!.output },
    });
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(true);
    expect(await commitRuntimeWork(resumeClaim!, completed)).toBe(false);
    const instance = await getProcessInstance(ownerContext, accepted.id);
    expect(instance).toMatchObject({
      status: "COMPLETED",
      variables: { amount: 700, expenseRoute: "automatic" },
      decisionEvaluations: [expect.objectContaining({
        decisionKey: "expense-route",
        outcome: "MATCHED",
        matchedRuleIds: ["Rule_auto"],
        source: expect.objectContaining({ elementId: "route", checkpointRevision: 2 }),
      })],
    });
  });
});
