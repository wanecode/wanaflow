import { createHash, randomUUID } from "node:crypto";

import {
  assertRuntimeProfile,
  type RuntimeAdvanceResult,
  type RuntimeEnvelope,
  type RuntimeDecisionSource,
  type RuntimeVariables,
} from "@wanaflow/runtime";
import { parseFormSource, validateFormSubmission } from "@wanaflow/modeling";
import type { PoolClient } from "pg";

import { assertPermission } from "./authorization";
import {
  DuplicateResourceError,
  PermissionDeniedError,
  ResourceNotFoundError,
  RuntimePolicyError,
  RuntimeStateConflictError,
} from "./errors";
import { getPool, withTransaction } from "./pool";
import { listExternalJobs } from "./external-jobs";
import { listProcessTimers } from "./timers";
import { listMessageSubscriptions } from "./message-subscriptions";
import { listMessageDeliveries } from "./message-deliveries";
import { listDecisionEvaluations } from "./decision-evaluations";
import { insertNotification, notifyWorkspaceRoles } from "./notifications";
import type {
  PrincipalContext,
  ProcessExecutionEvent,
  ProcessInstance,
  ProcessInstanceStatus,
  ProcessInstanceSummary,
  ProcessTask,
  RuntimeIncident,
  TaskAssigneeCandidate,
} from "./types";

type JsonObject = Record<string, unknown>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeObject(input: unknown, label: string): JsonObject {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimePolicyError("INVALID_RUNTIME_PAYLOAD", `${label} must be a JSON object.`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new RuntimePolicyError("INVALID_RUNTIME_PAYLOAD", `${label} must be JSON serializable.`);
  }
  if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
    throw new RuntimePolicyError("RUNTIME_PAYLOAD_TOO_LARGE", `${label} exceeds the 1 MiB limit.`);
  }
  return JSON.parse(serialized) as JsonObject;
}

type ProjectionTask = {
  id: string;
  elementId: string;
  elementName: string;
  executionId: string;
  assigneeId: string | null;
  candidateGroupKey: string | null;
  formKey: string | null;
  formSchemaSha256: string | null;
  inputMapping: Record<string, string> | null;
  outputMapping: Record<string, string> | null;
};

type ProjectionJob = {
  id: string;
  elementId: string;
  elementName: string;
  executionId: string;
  jobType: string;
  input: JsonObject;
  headers: Record<string, null | boolean | number | string>;
  outputMapping: Record<string, string>;
  lockDurationSeconds: number;
  maxAttempts: number;
  retryBackoffSeconds: number;
  effectKey: string;
};

type ProjectionTimer = {
  id: string;
  elementId: string;
  elementName: string;
  executionId: string;
  timerType: "DURATION" | "DATE";
  expression: string;
  durationMilliseconds: number | null;
  dueAt: string;
};

type ProjectionMessageSubscription = {
  id: string;
  elementId: string;
  elementName: string;
  executionId: string;
  messageName: string;
  correlationKey: string;
};

export function runtimeProjectionSha256(input: {
  status: "WAITING" | "COMPLETED";
  variables: JsonObject;
  tasks: ProjectionTask[];
  jobs?: ProjectionJob[];
  timers?: ProjectionTimer[];
  messageSubscriptions?: ProjectionMessageSubscription[];
}) {
  return sha256({
    status: input.status,
    variables: input.variables,
    tasks: [...input.tasks].sort((left, right) => left.id.localeCompare(right.id)),
    jobs: [...(input.jobs ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    timers: [...(input.timers ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    messageSubscriptions: [...(input.messageSubscriptions ?? [])]
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

type InstanceRow = {
  id: string;
  project_id: string;
  deployment_id: string;
  publication_id: string;
  artifact_version_id: string;
  environment_id: string;
  environment_key: string;
  environment_name: string;
  process_name: string;
  business_key: string | null;
  status: ProcessInstanceStatus;
  revision: number;
  current_element_id: string | null;
  current_element_name: string | null;
  started_by_id: string;
  started_by_name: string;
  started_by_email: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  envelope_sha256: string | null;
  projection_sha256: string | null;
  adapter_name: string | null;
  adapter_version: string | null;
  engine_version: string | null;
};

const INSTANCE_SELECT = `
  SELECT
    instance.id,
    instance.project_id,
    instance.deployment_id,
    deployment.publication_id,
    instance.artifact_version_id,
    instance.environment_id,
    environment.key AS environment_key,
    environment.name AS environment_name,
    instance.process_name,
    instance.business_key,
    instance.status,
    instance.revision,
    instance.current_element_id,
    instance.current_element_name,
    starter.id AS started_by_id,
    starter.display_name AS started_by_name,
    starter.email AS started_by_email,
    instance.created_at,
    instance.updated_at,
    instance.completed_at,
    instance.envelope_sha256,
    instance.projection_sha256,
    instance.adapter_name,
    instance.adapter_version,
    instance.engine_version
  FROM process_instances instance
  JOIN deployments deployment
    ON deployment.id = instance.deployment_id AND deployment.organization_id = instance.organization_id
  JOIN environments environment
    ON environment.id = instance.environment_id AND environment.organization_id = instance.organization_id
  JOIN principals starter
    ON starter.id = instance.created_by AND starter.organization_id = instance.organization_id
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

function mapInstanceSummary(row: InstanceRow): ProcessInstanceSummary {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    environment: { id: row.environment_id, key: row.environment_key, name: row.environment_name },
    processName: row.process_name,
    businessKey: row.business_key,
    status: row.status,
    revision: row.revision,
    currentElement:
      row.current_element_id && row.current_element_name
        ? { id: row.current_element_id, name: row.current_element_name }
        : null,
    startedBy: {
      id: row.started_by_id,
      displayName: row.started_by_name,
      email: row.started_by_email,
    },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function taskScopeClause(context: PrincipalContext, offset: number) {
  if (new Set(["organization-owner", "workspace-admin", "operator"]).has(context.role)) {
    return { sql: "", values: [] as string[] };
  }
  return {
    sql: ` AND (
      task.assignee_id = $${offset}
      OR (
        task.assignee_id IS NULL
        AND EXISTS (
          SELECT 1 FROM work_group_members visible_group
          WHERE visible_group.group_id = task.candidate_group_id
            AND visible_group.principal_id = $${offset}
        )
      )
    )`,
    values: [context.principal.id],
  };
}

export async function listProcessInstances(context: PrincipalContext): Promise<ProcessInstanceSummary[]> {
  assertPermission(context, "instance:read");
  const values: Array<string | null> = [context.organization.id, context.workspaceScopeId];
  let principalScope = "";
  if (context.role === "task-worker") {
    values.push(context.principal.id);
    principalScope = ` AND EXISTS (
      SELECT 1 FROM process_tasks visible_task
      WHERE visible_task.instance_id = instance.id AND (
        visible_task.assignee_id = $3 OR (
          visible_task.assignee_id IS NULL AND EXISTS (
            SELECT 1 FROM work_group_members visible_group
            WHERE visible_group.group_id = visible_task.candidate_group_id
              AND visible_group.principal_id = $3
          )
        )
      )
    )`;
  }
  const result = await getPool().query<InstanceRow>(
    `${INSTANCE_SELECT}
     WHERE instance.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       ${principalScope}
     ORDER BY instance.updated_at DESC, instance.id DESC`,
    values,
  );
  return result.rows.map(mapInstanceSummary);
}

export async function getProcessInstance(
  context: PrincipalContext,
  instanceId: string,
): Promise<ProcessInstance> {
  assertPermission(context, "instance:read");
  const values: Array<string | null> = [instanceId, context.organization.id, context.workspaceScopeId];
  let principalScope = "";
  if (context.role === "task-worker") {
    values.push(context.principal.id);
    principalScope = ` AND EXISTS (
      SELECT 1 FROM process_tasks visible_task
      WHERE visible_task.instance_id = instance.id AND (
        visible_task.assignee_id = $4 OR (
          visible_task.assignee_id IS NULL AND EXISTS (
            SELECT 1 FROM work_group_members visible_group
            WHERE visible_group.group_id = visible_task.candidate_group_id
              AND visible_group.principal_id = $4
          )
        )
      )
    )`;
  }
  const result = await getPool().query<InstanceRow>(
    `${INSTANCE_SELECT}
     WHERE instance.id = $1 AND instance.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)
       ${principalScope}`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new ResourceNotFoundError("process instance");

  const [variablesResult, eventResult, incidentResult, incidentNoteResult, jobs, timers, messageSubscriptions, messageDeliveries, decisionEvaluations] = await Promise.all([
    getPool().query<{ variables: JsonObject }>(
      `SELECT variables FROM process_variable_snapshots
       WHERE instance_id = $1 AND checkpoint_revision = $2`,
      [instanceId, row.revision],
    ),
    getPool().query<{
      id: string;
      sequence: number;
      checkpoint_revision: number;
      type: string;
      element_id: string | null;
      element_name: string | null;
      actor_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      data: JsonObject;
      created_at: Date;
    }>(
      `SELECT event.id, event.sequence, event.checkpoint_revision, event.type,
         event.element_id, event.element_name, actor.id AS actor_id,
         actor.display_name AS actor_name, actor.email AS actor_email,
         event.data, event.created_at
       FROM execution_events event
       LEFT JOIN principals actor
         ON actor.id = event.actor_id AND actor.organization_id = event.organization_id
       WHERE event.instance_id = $1 AND event.organization_id = $2
       ORDER BY event.sequence ASC`,
      [instanceId, context.organization.id],
    ),
    getPool().query<{
      id: string;
      job_id: string | null;
      timer_id: string | null;
      subscription_id: string | null;
      code: string;
      message: string;
      status: "OPEN" | "RESOLVED";
      owner_id: string | null;
      owner_name: string | null;
      owner_email: string | null;
      created_at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT incident.id, incident.job_id, incident.timer_id, incident.subscription_id,
         incident.code, incident.message, incident.status,
         owner.id AS owner_id, owner.display_name AS owner_name, owner.email AS owner_email,
         incident.created_at, incident.resolved_at
       FROM runtime_incidents incident
       LEFT JOIN principals owner
         ON owner.id = incident.owner_id AND owner.organization_id = incident.organization_id
       WHERE incident.instance_id = $1 AND incident.organization_id = $2
       ORDER BY incident.created_at DESC`,
      [instanceId, context.organization.id],
    ),
    getPool().query<{
      id: string;
      incident_id: string;
      action: "NOTE" | "OWNER_CHANGED" | "RETRY_STARTED" | "RESOLVED";
      body: string | null;
      author_id: string;
      author_name: string;
      author_email: string;
      created_at: Date;
    }>(
      `SELECT note.id, note.incident_id, note.action, note.body,
         author.id AS author_id, author.display_name AS author_name, author.email AS author_email,
         note.created_at
       FROM runtime_incident_notes note
       JOIN runtime_incidents incident
         ON incident.id = note.incident_id AND incident.organization_id = note.organization_id
       JOIN principals author
         ON author.id = note.author_id AND author.organization_id = note.organization_id
       WHERE incident.instance_id = $1 AND note.organization_id = $2
       ORDER BY note.created_at ASC`,
      [instanceId, context.organization.id],
    ),
    context.permissions.includes("job:read")
      ? listExternalJobs(context, { instanceId })
      : Promise.resolve([]),
    context.permissions.includes("timer:read")
      ? listProcessTimers(context, { instanceId })
      : Promise.resolve([]),
    context.permissions.includes("message:read")
      ? listMessageSubscriptions(context, { instanceId })
      : Promise.resolve([]),
    context.permissions.includes("message:read")
      ? listMessageDeliveries(context, { instanceId })
      : Promise.resolve([]),
    context.permissions.includes("decision:read")
      ? listDecisionEvaluations(context, { instanceId })
      : Promise.resolve([]),
  ]);

  const events: ProcessExecutionEvent[] = eventResult.rows.map((event) => ({
    id: event.id,
    sequence: event.sequence,
    checkpointRevision: event.checkpoint_revision,
    type: event.type,
    element:
      event.element_id && event.element_name
        ? { id: event.element_id, name: event.element_name }
        : null,
    actor:
      event.actor_id && event.actor_name && event.actor_email
        ? { id: event.actor_id, displayName: event.actor_name, email: event.actor_email }
        : null,
    data: event.data,
    createdAt: event.created_at.toISOString(),
  }));
  const incidents: RuntimeIncident[] = incidentResult.rows.map((incident) => ({
    id: incident.id,
    code: incident.code,
    message: incident.message,
    status: incident.status,
    createdAt: incident.created_at.toISOString(),
    resolvedAt: incident.resolved_at?.toISOString() ?? null,
    owner: incident.owner_id && incident.owner_name && incident.owner_email
      ? { id: incident.owner_id, displayName: incident.owner_name, email: incident.owner_email }
      : null,
    notes: incidentNoteResult.rows
      .filter((note) => note.incident_id === incident.id)
      .map((note) => ({
        id: note.id,
        action: note.action,
        body: note.body,
        author: { id: note.author_id, displayName: note.author_name, email: note.author_email },
        createdAt: note.created_at.toISOString(),
      })),
    jobId: incident.job_id,
    timerId: incident.timer_id,
    subscriptionId: incident.subscription_id,
  }));
  return {
    ...mapInstanceSummary(row),
    projectId: row.project_id,
    publicationId: row.publication_id,
    artifactVersionId: row.artifact_version_id,
    variables: variablesResult.rows[0]?.variables ?? {},
    events,
    incidents,
    jobs,
    timers,
    messageSubscriptions,
    messageDeliveries,
    decisionEvaluations,
    checkpoint:
      row.revision > 0 && row.envelope_sha256 && row.projection_sha256 && row.adapter_name && row.adapter_version && row.engine_version
        ? {
            revision: row.revision,
            envelopeSha256: row.envelope_sha256,
            projectionSha256: row.projection_sha256,
            adapter: {
              name: row.adapter_name,
              version: row.adapter_version,
              engineVersion: row.engine_version,
            },
          }
        : null,
  };
}

export async function listRuntimeIncidentOwners(
  context: PrincipalContext,
  incidentId: string,
): Promise<TaskAssigneeCandidate[]> {
  assertPermission(context, "job:retry");
  const result = await getPool().query<{
    id: string;
    display_name: string;
    email: string;
    role: TaskAssigneeCandidate["role"];
  }>(
    `SELECT DISTINCT ON (principal.id) principal.id, principal.display_name,
       principal.email, membership.role
     FROM runtime_incidents incident
     JOIN process_instances instance
       ON instance.id = incident.instance_id AND instance.organization_id = incident.organization_id
     JOIN projects project
       ON project.id = instance.project_id AND project.organization_id = instance.organization_id
     JOIN organization_memberships membership
       ON membership.organization_id = incident.organization_id
       AND (membership.workspace_id IS NULL OR membership.workspace_id = project.workspace_id)
     JOIN principals principal
       ON principal.id = membership.principal_id AND principal.organization_id = membership.organization_id
     WHERE incident.id = $1 AND incident.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)
       AND membership.role IN ('organization-owner', 'workspace-admin', 'operator')
     ORDER BY principal.id`,
    [incidentId, context.organization.id, context.workspaceScopeId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  }));
}

export async function updateRuntimeIncident(
  context: PrincipalContext,
  incidentId: string,
  input: { ownerId?: string | null; note?: string | null },
) {
  assertPermission(context, "job:retry");
  const note = input.note?.trim() || null;
  if (input.ownerId === undefined && !note) {
    throw new RuntimePolicyError("INCIDENT_UPDATE_EMPTY", "Choose an owner or add a note.");
  }
  const instanceId = await withTransaction(async (client) => {
    const locked = await client.query<{
      instance_id: string;
      owner_id: string | null;
      workspace_id: string;
      status: "OPEN" | "RESOLVED";
    }>(
      `SELECT incident.instance_id, incident.owner_id, incident.status, project.workspace_id
       FROM runtime_incidents incident
       JOIN process_instances instance
         ON instance.id = incident.instance_id AND instance.organization_id = incident.organization_id
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE incident.id = $1 AND incident.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF incident`,
      [incidentId, context.organization.id, context.workspaceScopeId],
    );
    const incident = locked.rows[0];
    if (!incident) throw new ResourceNotFoundError("runtime incident");
    if (incident.status !== "OPEN") throw new RuntimeStateConflictError("This incident is already resolved.");
    if (input.ownerId !== undefined && input.ownerId !== null) {
      const eligible = await client.query(
        `SELECT 1 FROM organization_memberships
         WHERE organization_id = $1 AND principal_id = $2
           AND role IN ('organization-owner', 'workspace-admin', 'operator')
           AND (workspace_id IS NULL OR workspace_id = $3)`,
        [context.organization.id, input.ownerId, incident.workspace_id],
      );
      if (!eligible.rowCount) throw new ResourceNotFoundError("incident owner");
    }
    if (input.ownerId !== undefined && input.ownerId !== incident.owner_id) {
      await client.query(
        "UPDATE runtime_incidents SET owner_id = $1 WHERE id = $2 AND organization_id = $3",
        [input.ownerId, incidentId, context.organization.id],
      );
      await client.query(
        `INSERT INTO runtime_incident_notes
          (organization_id, incident_id, author_id, action, body)
         VALUES ($1, $2, $3, 'OWNER_CHANGED', $4)`,
        [context.organization.id, incidentId, context.principal.id,
          input.ownerId ? "Incident owner changed." : "Incident returned to the operations queue."],
      );
      if (input.ownerId) {
        await insertNotification(client, {
          organizationId: context.organization.id,
          recipientId: input.ownerId,
          actorId: context.principal.id,
          kind: "INCIDENT_ASSIGNED",
          title: "Incident assigned to you",
          body: "A process needs an operator decision.",
          href: `/operations/${incident.instance_id}`,
          resourceType: "runtime-incident",
          resourceId: incidentId,
          dedupeKey: `incident:${incidentId}:owner:${input.ownerId}`,
        });
      }
    }
    if (note) {
      await client.query(
        `INSERT INTO runtime_incident_notes
          (organization_id, incident_id, author_id, action, body)
         VALUES ($1, $2, $3, 'NOTE', $4)`,
        [context.organization.id, incidentId, context.principal.id, note],
      );
    }
    await insertRuntimeAudit(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "runtime_incident.updated",
      resourceId: incidentId,
      payload: { ownerId: input.ownerId, noteAdded: !!note },
    });
    return incident.instance_id;
  });
  return getProcessInstance(context, instanceId);
}

async function runtimeDeployment(
  context: PrincipalContext,
  deploymentId: string,
) {
  const result = await getPool().query<{
    id: string;
    project_id: string;
    environment_id: string;
    bundle_sha256: string;
    artifact_version_id: string;
    artifact_name: string;
    source: string;
  }>(
    `SELECT deployment.id, deployment.project_id, deployment.environment_id,
       deployment.bundle_sha256, version.id AS artifact_version_id,
       artifact.name AS artifact_name, revision.source
     FROM deployments deployment
     JOIN projects project
       ON project.id = deployment.project_id AND project.organization_id = deployment.organization_id
     JOIN artifact_versions version
       ON version.publication_id = deployment.publication_id AND version.organization_id = deployment.organization_id
     JOIN artifacts artifact
       ON artifact.id = version.artifact_id AND artifact.organization_id = deployment.organization_id
       AND artifact.type = 'BPMN_PROCESS'
     JOIN artifact_revisions revision
       ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
     WHERE deployment.id = $1 AND deployment.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [deploymentId, context.organization.id, context.workspaceScopeId],
  );
  if (result.rows.length !== 1) {
    throw new RuntimePolicyError(
      "DEPLOYMENT_PROCESS_COUNT",
      "The immutable deployment must contain exactly one BPMN process artifact.",
    );
  }
  return result.rows[0];
}

export async function startProcessInstance(
  context: PrincipalContext,
  input: {
    deploymentId: string;
    businessKey?: string | null;
    variables?: unknown;
    idempotencyKey?: string | null;
  },
) {
  assertPermission(context, "instance:start");
  const deployment = await runtimeDeployment(context, input.deploymentId);
  await assertRuntimeProfile(deployment.source);
  const variables = normalizeObject(input.variables, "variables");
  const businessKey = input.businessKey?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const requestSha256 = sha256({
    type: "START",
    deploymentId: input.deploymentId,
    businessKey,
    variables,
  });
  if (businessKey && businessKey.length > 255) {
    throw new RuntimePolicyError("BUSINESS_KEY_TOO_LONG", "The business key cannot exceed 255 characters.");
  }
  if (idempotencyKey && idempotencyKey.length > 255) {
    throw new RuntimePolicyError("IDEMPOTENCY_KEY_TOO_LONG", "The idempotency key cannot exceed 255 characters.");
  }

  if (idempotencyKey) {
    const existing = await getPool().query<{ instance_id: string; request_sha256: string }>(
      `SELECT instance_id, request_sha256 FROM runtime_commands
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [context.organization.id, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_sha256 !== requestSha256) {
        throw new RuntimeStateConflictError("This idempotency key was already used for a different start request.");
      }
      return getProcessInstance(context, existing.rows[0].instance_id);
    }
  }

  const instanceId = randomUUID();
  const commandId = randomUUID();
  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO process_instances
          (id, organization_id, project_id, environment_id, deployment_id,
           artifact_version_id, process_name, business_key, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'STARTING', $9)`,
        [
          instanceId,
          context.organization.id,
          deployment.project_id,
          deployment.environment_id,
          deployment.id,
          deployment.artifact_version_id,
          deployment.artifact_name,
          businessKey,
          context.principal.id,
        ],
      );
      await client.query(
        `INSERT INTO process_variable_snapshots
          (instance_id, organization_id, checkpoint_revision, variables)
         VALUES ($1, $2, 0, $3::jsonb)`,
        [instanceId, context.organization.id, JSON.stringify(variables)],
      );
      await client.query(
        `INSERT INTO runtime_commands
          (id, organization_id, instance_id, type, status, expected_revision,
          payload, idempotency_key, request_sha256, created_by)
         VALUES ($1, $2, $3, 'START', 'ACCEPTED', 0, $4::jsonb, $5, $6, $7)`,
        [commandId, context.organization.id, instanceId, JSON.stringify({ variables }), idempotencyKey, requestSha256, context.principal.id],
      );
      await client.query(
        `UPDATE process_instances SET pending_command_id = $1 WHERE id = $2`,
        [commandId, instanceId],
      );
      await client.query(
        `INSERT INTO durable_work
          (id, organization_id, instance_id, command_id, kind, status)
         VALUES ($1, $2, $3, $4, 'ADVANCE_INSTANCE', 'AVAILABLE')`,
        [randomUUID(), context.organization.id, instanceId, commandId],
      );
      await insertRuntimeAudit(client, {
        organizationId: context.organization.id,
        actorId: context.principal.id,
        action: "process_instance.start_accepted",
        resourceId: instanceId,
        payload: { instanceId, deploymentId: deployment.id, commandId, businessKey },
      });
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      if (idempotencyKey) {
        const existing = await getPool().query<{ instance_id: string; request_sha256: string }>(
          `SELECT instance_id, request_sha256 FROM runtime_commands WHERE organization_id = $1 AND idempotency_key = $2`,
          [context.organization.id, idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].request_sha256 !== requestSha256) {
            throw new RuntimeStateConflictError("This idempotency key was already used for a different start request.");
          }
          return getProcessInstance(context, existing.rows[0].instance_id);
        }
      }
      throw new DuplicateResourceError(businessKey ? "business key" : "idempotency key");
    }
    throw error;
  }
  return getProcessInstance(context, instanceId);
}

export async function cancelProcessInstance(
  context: PrincipalContext,
  instanceId: string,
  input: { reason?: string | null } = {},
) {
  assertPermission(context, "instance:cancel");
  const reason = input.reason?.trim().slice(0, 1000) || null;
  await withTransaction(async (client) => {
    const result = await client.query<{
      status: ProcessInstanceStatus;
      revision: number;
      pending_command_id: string | null;
    }>(
      `SELECT instance.status, instance.revision, instance.pending_command_id
       FROM process_instances instance
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE instance.id = $1 AND instance.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF instance`,
      [instanceId, context.organization.id, context.workspaceScopeId],
    );
    const instance = result.rows[0];
    if (!instance) throw new ResourceNotFoundError("process instance");
    if (instance.status === "CANCELLED") return;
    if (instance.status === "COMPLETED") throw new RuntimeStateConflictError("A completed process instance cannot be cancelled.");
    if (instance.pending_command_id) {
      throw new RuntimeStateConflictError("The process has an accepted command awaiting incorporation and cannot be cancelled yet.");
    }
    if (instance.revision < 1) throw new RuntimeStateConflictError("The process must reach its first checkpoint before cancellation.");

    await client.query(
      `UPDATE process_instances SET status = 'CANCELLED', updated_at = now(),
         current_element_id = NULL, current_element_name = NULL
       WHERE id = $1`,
      [instanceId],
    );
    await client.query(
      `UPDATE external_job_deliveries delivery SET status = 'SUPERSEDED',
         worker_id = NULL, credential_id = NULL, lock_expires_at = NULL,
         finished_at = now(), updated_at = now()
       FROM process_jobs job
       WHERE delivery.job_id = job.id AND job.instance_id = $1
         AND delivery.status IN ('AVAILABLE', 'LOCKED')`,
      [instanceId],
    );
    await client.query(
      `UPDATE runtime_incidents SET status = 'RESOLVED', resolved_at = now()
       WHERE instance_id = $1 AND status = 'OPEN'`,
      [instanceId],
    );
    const sequence = await client.query<{ value: number }>(
      `SELECT (coalesce(max(sequence), 0) + 1)::integer AS value
       FROM execution_events WHERE instance_id = $1`,
      [instanceId],
    );
    await client.query(
      `INSERT INTO execution_events
        (id, organization_id, instance_id, sequence, checkpoint_revision, type, actor_id, data)
       VALUES ($1, $2, $3, $4, $5, 'PROCESS_CANCELLED', $6, $7::jsonb)`,
      [randomUUID(), context.organization.id, instanceId, sequence.rows[0].value,
        instance.revision, context.principal.id, JSON.stringify({ reason })],
    );
    await insertRuntimeAudit(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "process_instance.cancelled",
      resourceId: instanceId,
      payload: { instanceId, revision: instance.revision, reason },
    });
  });
  return getProcessInstance(context, instanceId);
}

type TaskRow = {
  id: string;
  instance_id: string;
  process_name: string;
  business_key: string | null;
  element_id: string;
  element_name: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  completion_pending: boolean;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  candidate_group_id: string | null;
  candidate_group_key: string | null;
  candidate_group_name: string | null;
  due_at: Date | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  delegated_from_id: string | null;
  delegated_from_name: string | null;
  delegated_from_email: string | null;
  delegated_by_id: string | null;
  delegated_by_name: string | null;
  delegated_by_email: string | null;
  delegated_at: Date | null;
  variables: JsonObject;
  form_key: string | null;
  form_version_id: string | null;
  form_schema: JsonObject | null;
  form_schema_sha256: string | null;
  form_data: JsonObject | null;
  input_mapping: Record<string, string> | null;
  output_mapping: Record<string, string> | null;
  submission: JsonObject | null;
  created_at: Date;
  completed_at: Date | null;
};

const TASK_SELECT = `
  SELECT task.id, task.instance_id, instance.process_name, instance.business_key,
    task.element_id, task.element_name,
    CASE WHEN instance.status = 'CANCELLED' AND task.status = 'OPEN'
      THEN 'CANCELLED' ELSE task.status END AS status,
    EXISTS (
      SELECT 1 FROM runtime_commands pending
      WHERE pending.id = instance.pending_command_id AND pending.target_task_id = task.id
        AND pending.status IN ('ACCEPTED', 'CLAIMED')
    ) AS completion_pending,
    assignee.id AS assignee_id, assignee.display_name AS assignee_name,
    assignee.email AS assignee_email,
    candidate_group.id AS candidate_group_id, candidate_group.key AS candidate_group_key,
    candidate_group.name AS candidate_group_name, task.due_at, task.priority,
    delegated_from.id AS delegated_from_id,
    delegated_from.display_name AS delegated_from_name,
    delegated_from.email AS delegated_from_email,
    delegated_by.id AS delegated_by_id,
    delegated_by.display_name AS delegated_by_name,
    delegated_by.email AS delegated_by_email,
    task.delegated_at, variables.variables,
    task.form_key, task.form_version_id, task.form_schema,
    task.form_schema_sha256, task.form_data, task.input_mapping, task.output_mapping,
    task.submission, task.created_at, task.completed_at
  FROM process_tasks task
  JOIN process_instances instance
    ON instance.id = task.instance_id AND instance.organization_id = task.organization_id
  LEFT JOIN principals assignee
    ON assignee.id = task.assignee_id AND assignee.organization_id = task.organization_id
  LEFT JOIN work_groups candidate_group
    ON candidate_group.id = task.candidate_group_id AND candidate_group.organization_id = task.organization_id
  LEFT JOIN principals delegated_from
    ON delegated_from.id = task.delegated_from AND delegated_from.organization_id = task.organization_id
  LEFT JOIN principals delegated_by
    ON delegated_by.id = task.delegated_by AND delegated_by.organization_id = task.organization_id
  JOIN process_variable_snapshots variables
    ON variables.instance_id = instance.id AND variables.checkpoint_revision = instance.revision
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

async function mapTask(row: TaskRow): Promise<ProcessTask> {
  const history = await getPool().query<{
    id: string;
    due_at: Date | null;
    note: string | null;
    created_at: Date;
    from_id: string | null;
    from_name: string | null;
    from_email: string | null;
    to_id: string;
    to_name: string;
    to_email: string;
    actor_id: string;
    actor_name: string;
    actor_email: string;
  }>(
    `SELECT event.id, event.due_at, event.note, event.created_at,
       previous.id AS from_id, previous.display_name AS from_name, previous.email AS from_email,
       next.id AS to_id, next.display_name AS to_name, next.email AS to_email,
       actor.id AS actor_id, actor.display_name AS actor_name, actor.email AS actor_email
     FROM process_task_assignment_events event
     LEFT JOIN principals previous
       ON previous.id = event.from_assignee_id AND previous.organization_id = event.organization_id
     JOIN principals next
       ON next.id = event.to_assignee_id AND next.organization_id = event.organization_id
     JOIN principals actor
       ON actor.id = event.changed_by AND actor.organization_id = event.organization_id
     WHERE event.task_id = $1
     ORDER BY event.created_at ASC`,
    [row.id],
  );
  return {
    id: row.id,
    instanceId: row.instance_id,
    processName: row.process_name,
    businessKey: row.business_key,
    elementId: row.element_id,
    elementName: row.element_name,
    status: row.status,
    completionPending: row.completion_pending,
    assignee: row.assignee_id && row.assignee_name && row.assignee_email
      ? { id: row.assignee_id, displayName: row.assignee_name, email: row.assignee_email }
      : null,
    candidateGroup: row.candidate_group_id && row.candidate_group_key && row.candidate_group_name
      ? { id: row.candidate_group_id, key: row.candidate_group_key, name: row.candidate_group_name }
      : null,
    claimable: row.status === "OPEN" && !row.assignee_id && !!row.candidate_group_id,
    dueAt: row.due_at?.toISOString() ?? null,
    priority: row.priority,
    delegatedFrom: row.delegated_from_id && row.delegated_from_name && row.delegated_from_email
      ? { id: row.delegated_from_id, displayName: row.delegated_from_name, email: row.delegated_from_email }
      : null,
    delegatedBy: row.delegated_by_id && row.delegated_by_name && row.delegated_by_email
      ? { id: row.delegated_by_id, displayName: row.delegated_by_name, email: row.delegated_by_email }
      : null,
    delegatedAt: row.delegated_at?.toISOString() ?? null,
    assignmentHistory: history.rows.map((event) => ({
      id: event.id,
      fromAssignee: event.from_id && event.from_name && event.from_email
        ? { id: event.from_id, displayName: event.from_name, email: event.from_email }
        : null,
      toAssignee: { id: event.to_id, displayName: event.to_name, email: event.to_email },
      changedBy: { id: event.actor_id, displayName: event.actor_name, email: event.actor_email },
      dueAt: event.due_at?.toISOString() ?? null,
      note: event.note,
      createdAt: event.created_at.toISOString(),
    })),
    variables: row.variables,
    form: row.form_key && row.form_version_id && row.form_schema && row.form_schema_sha256 && row.form_data
      ? {
          key: row.form_key,
          versionId: row.form_version_id,
          schema: row.form_schema,
          schemaSha256: row.form_schema_sha256,
          data: row.form_data,
        }
      : null,
    submission: row.submission,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export async function listMyTasks(context: PrincipalContext): Promise<ProcessTask[]> {
  assertPermission(context, "task:read");
  const result = await getPool().query<TaskRow>(
    `${TASK_SELECT}
     WHERE task.organization_id = $1 AND task.status = 'OPEN' AND instance.status = 'WAITING'
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND (
         task.assignee_id = $3 OR (
           task.assignee_id IS NULL AND EXISTS (
             SELECT 1 FROM work_group_members my_group
             WHERE my_group.group_id = task.candidate_group_id
               AND my_group.principal_id = $3
           )
         )
       )
     ORDER BY task.due_at ASC NULLS LAST, task.created_at ASC, task.id ASC`,
    [context.organization.id, context.workspaceScopeId, context.principal.id],
  );
  return Promise.all(result.rows.map(mapTask));
}

export async function getProcessTask(context: PrincipalContext, taskId: string): Promise<ProcessTask> {
  assertPermission(context, "task:read");
  const scope = taskScopeClause(context, 4);
  const result = await getPool().query<TaskRow>(
    `${TASK_SELECT}
     WHERE task.id = $1 AND task.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)
       ${scope.sql}`,
    [taskId, context.organization.id, context.workspaceScopeId, ...scope.values],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("task");
  return mapTask(result.rows[0]);
}

export async function listTaskAssigneeCandidates(
  context: PrincipalContext,
  taskId: string,
): Promise<TaskAssigneeCandidate[]> {
  assertPermission(context, "task:assign");
  await getProcessTask(context, taskId);
  const result = await getPool().query<{
    id: string;
    display_name: string;
    email: string;
    role: TaskAssigneeCandidate["role"];
  }>(
    `SELECT DISTINCT ON (principal.id)
       principal.id, principal.display_name, principal.email, membership.role
     FROM process_tasks task
     JOIN process_instances instance
       ON instance.id = task.instance_id AND instance.organization_id = task.organization_id
     JOIN projects project
       ON project.id = instance.project_id AND project.organization_id = instance.organization_id
     JOIN principals principal ON principal.organization_id = task.organization_id
     JOIN organization_memberships membership
       ON membership.principal_id = principal.id
       AND membership.organization_id = principal.organization_id
       AND (membership.workspace_id IS NULL OR membership.workspace_id = project.workspace_id)
     WHERE task.id = $1 AND task.organization_id = $2
       AND membership.role IN ('organization-owner', 'workspace-admin', 'designer', 'operator', 'task-worker')
     ORDER BY principal.id,
       CASE membership.role
         WHEN 'task-worker' THEN 1 WHEN 'operator' THEN 2 WHEN 'designer' THEN 3
         WHEN 'workspace-admin' THEN 4 ELSE 5
       END`,
    [taskId, context.organization.id],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  }));
}

export async function updateProcessTaskAssignment(
  context: PrincipalContext,
  taskId: string,
  input: {
    assigneeId: string;
    dueAt?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    note?: string | null;
  },
): Promise<ProcessTask> {
  assertPermission(context, "task:assign");
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.dueAt && Number.isNaN(dueAt!.getTime())) {
    throw new RuntimePolicyError("INVALID_TASK_DUE_DATE", "Choose a valid due date and time.");
  }

  await withTransaction(async (client) => {
    const locked = await client.query<{
      assignee_id: string | null;
      status: "OPEN" | "COMPLETED" | "CANCELLED";
      instance_status: ProcessInstanceStatus;
      workspace_id: string;
    }>(
      `SELECT task.assignee_id, task.status, instance.status AS instance_status,
         project.workspace_id
       FROM process_tasks task
       JOIN process_instances instance
         ON instance.id = task.instance_id AND instance.organization_id = task.organization_id
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE task.id = $1 AND task.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF task`,
      [taskId, context.organization.id, context.workspaceScopeId],
    );
    const task = locked.rows[0];
    if (!task) throw new ResourceNotFoundError("task");
    if (task.status !== "OPEN" || task.instance_status !== "WAITING") {
      throw new RuntimeStateConflictError("Only an open task at the active process wait can be reassigned.");
    }
    if (context.role === "task-worker" && task.assignee_id !== context.principal.id) {
      throw new PermissionDeniedError("task:assign:assigned");
    }
    const candidate = await client.query(
      `SELECT 1
       FROM principals principal
       JOIN organization_memberships membership
         ON membership.principal_id = principal.id
         AND membership.organization_id = principal.organization_id
       WHERE principal.id = $1 AND principal.organization_id = $2
         AND membership.role IN ('organization-owner', 'workspace-admin', 'designer', 'operator', 'task-worker')
         AND (membership.workspace_id IS NULL OR membership.workspace_id = $3)`,
      [input.assigneeId, context.organization.id, task.workspace_id],
    );
    if (!candidate.rowCount) throw new ResourceNotFoundError("task assignee");

    const reassigned = input.assigneeId !== task.assignee_id;
    const delegated = reassigned && task.assignee_id !== null;
    await client.query(
      `UPDATE process_tasks SET
         assignee_id = $1,
         due_at = CASE WHEN $9 THEN $2::timestamptz ELSE due_at END,
         priority = coalesce($3, priority),
         delegated_from = CASE WHEN $4 THEN $5::uuid ELSE delegated_from END,
         delegated_by = CASE WHEN $4 THEN $6::uuid ELSE delegated_by END,
         delegated_at = CASE WHEN $4 THEN now() ELSE delegated_at END
       WHERE id = $7 AND organization_id = $8`,
      [
        input.assigneeId,
        dueAt?.toISOString() ?? null,
        input.priority ?? null,
        delegated,
        task.assignee_id,
        context.principal.id,
        taskId,
        context.organization.id,
        input.dueAt !== undefined,
      ],
    );
    await client.query(
      `INSERT INTO process_task_assignment_events
        (organization_id, task_id, from_assignee_id, to_assignee_id, changed_by, due_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        context.organization.id,
        taskId,
        task.assignee_id,
        input.assigneeId,
        context.principal.id,
        dueAt?.toISOString() ?? null,
        input.note?.trim() || null,
      ],
    );
    await insertRuntimeAudit(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: reassigned ? "process_task.delegated" : "process_task.schedule_changed",
      resourceId: taskId,
      payload: {
        taskId,
        fromAssigneeId: task.assignee_id,
        toAssigneeId: input.assigneeId,
        dueAt: dueAt?.toISOString() ?? null,
        priority: input.priority ?? null,
      },
    });
    if (reassigned) {
      await insertNotification(client, {
        organizationId: context.organization.id,
        recipientId: input.assigneeId,
        actorId: context.principal.id,
        kind: "TASK_HANDED_OFF",
        title: "Work handed to you",
        body: input.note?.trim() || "A process task now needs your attention.",
        href: `/work?task=${taskId}`,
        resourceType: "process-task",
        resourceId: taskId,
        dedupeKey: `task:${taskId}:handoff:${input.assigneeId}`,
      });
    }
  });

  const result = await getPool().query<TaskRow>(
    `${TASK_SELECT}
     WHERE task.id = $1 AND task.organization_id = $2`,
    [taskId, context.organization.id],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("task");
  return mapTask(result.rows[0]);
}

export async function claimProcessTask(
  context: PrincipalContext,
  taskId: string,
): Promise<ProcessTask> {
  assertPermission(context, "task:complete");
  await withTransaction(async (client) => {
    const locked = await client.query<{
      assignee_id: string | null;
      candidate_group_id: string | null;
      status: "OPEN" | "COMPLETED" | "CANCELLED";
      instance_status: ProcessInstanceStatus;
    }>(
      `SELECT task.assignee_id, task.candidate_group_id, task.status,
         instance.status AS instance_status
       FROM process_tasks task
       JOIN process_instances instance
         ON instance.id = task.instance_id AND instance.organization_id = task.organization_id
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE task.id = $1 AND task.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF task`,
      [taskId, context.organization.id, context.workspaceScopeId],
    );
    const task = locked.rows[0];
    if (!task) throw new ResourceNotFoundError("task");
    if (task.assignee_id) {
      if (task.assignee_id === context.principal.id) return;
      throw new RuntimeStateConflictError("This task has already been claimed.");
    }
    if (task.status !== "OPEN" || task.instance_status !== "WAITING" || !task.candidate_group_id) {
      throw new RuntimeStateConflictError("This task is not available to claim.");
    }
    const member = await client.query(
      `SELECT 1 FROM work_group_members
       WHERE organization_id = $1 AND group_id = $2 AND principal_id = $3`,
      [context.organization.id, task.candidate_group_id, context.principal.id],
    );
    if (!member.rowCount) throw new PermissionDeniedError("task:claim:candidate-group");
    await client.query(
      "UPDATE process_tasks SET assignee_id = $1 WHERE id = $2 AND organization_id = $3",
      [context.principal.id, taskId, context.organization.id],
    );
    await client.query(
      `INSERT INTO process_task_assignment_events
        (organization_id, task_id, from_assignee_id, to_assignee_id, changed_by, note)
       VALUES ($1, $2, NULL, $3, $3, 'Claimed from the team queue')`,
      [context.organization.id, taskId, context.principal.id],
    );
    await insertRuntimeAudit(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "process_task.claimed",
      resourceId: taskId,
      payload: { taskId, candidateGroupId: task.candidate_group_id },
    });
  });
  return getProcessTask(context, taskId);
}

export async function completeProcessTask(
  context: PrincipalContext,
  taskId: string,
  input: { output?: unknown; idempotencyKey?: string | null },
) {
  assertPermission(context, "task:complete");
  const visibleTask = await getProcessTask(context, taskId);
  if (!visibleTask.assignee || visibleTask.assignee.id !== context.principal.id) {
    throw new PermissionDeniedError("task:complete:assigned");
  }
  const submission = normalizeObject(input.output, visibleTask.form ? "form data" : "output");
  let output = submission;
  if (visibleTask.form) {
    const formMetadata = await getPool().query<{
      form_schema: JsonObject;
      output_mapping: Record<string, string>;
    }>(
      `SELECT form_schema, output_mapping FROM process_tasks
       WHERE id = $1 AND organization_id = $2`,
      [taskId, context.organization.id],
    );
    const metadata = formMetadata.rows[0];
    if (!metadata) throw new ResourceNotFoundError("task");
    const errors = validateFormSubmission(metadata.form_schema as ReturnType<typeof parseFormSource>, submission);
    if (errors.length) {
      throw new RuntimePolicyError(
        "FORM_SUBMISSION_INVALID",
        errors.map((error) => error.message).join(" "),
      );
    }
    output = {};
    for (const [variableKey, formFieldKey] of Object.entries(metadata.output_mapping)) {
      if (Object.hasOwn(submission, formFieldKey)) output[variableKey] = submission[formFieldKey];
    }
  }
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const requestSha256 = sha256({ type: "TASK_COMPLETE", taskId, submission });
  if (idempotencyKey) {
    const existing = await getPool().query<{ id: string; instance_id: string; request_sha256: string }>(
      `SELECT id, instance_id, request_sha256 FROM runtime_commands
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [context.organization.id, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_sha256 !== requestSha256) {
        throw new RuntimeStateConflictError("This idempotency key was already used for a different task completion.");
      }
      return { accepted: true as const, commandId: existing.rows[0].id, task: await getProcessTask(context, taskId) };
    }
  }

  const commandId = randomUUID();
  await withTransaction(async (client) => {
    const locked = await client.query<{
      instance_id: string;
      checkpoint_revision: number;
      status: string;
      instance_status: string;
      revision: number;
      pending_command_id: string | null;
    }>(
      `SELECT task.instance_id, task.checkpoint_revision, task.status,
         instance.status AS instance_status, instance.revision, instance.pending_command_id
       FROM process_tasks task
       JOIN process_instances instance
         ON instance.id = task.instance_id AND instance.organization_id = task.organization_id
       WHERE task.id = $1 AND task.organization_id = $2
       FOR UPDATE OF task, instance`,
      [taskId, context.organization.id],
    );
    const task = locked.rows[0];
    if (!task) throw new ResourceNotFoundError("task");
    if (task.status !== "OPEN" || task.instance_status !== "WAITING" || task.checkpoint_revision !== task.revision) {
      throw new RuntimeStateConflictError("This task is no longer the active wait for the process instance.");
    }
    if (task.pending_command_id) {
      throw new RuntimeStateConflictError("The process already has an accepted command awaiting incorporation.");
    }
    await client.query(
      `INSERT INTO runtime_commands
        (id, organization_id, instance_id, type, status, expected_revision,
         target_task_id, payload, idempotency_key, request_sha256, created_by)
       VALUES ($1, $2, $3, 'TASK_COMPLETE', 'ACCEPTED', $4, $5, $6::jsonb, $7, $8, $9)`,
      [commandId, context.organization.id, task.instance_id, task.revision, taskId, JSON.stringify({ output, submission }), idempotencyKey, requestSha256, context.principal.id],
    );
    await client.query(
      `UPDATE process_instances SET pending_command_id = $1, updated_at = now() WHERE id = $2`,
      [commandId, task.instance_id],
    );
    await client.query(
      `INSERT INTO durable_work
        (id, organization_id, instance_id, command_id, kind, status)
       VALUES ($1, $2, $3, $4, 'ADVANCE_INSTANCE', 'AVAILABLE')`,
      [randomUUID(), context.organization.id, task.instance_id, commandId],
    );
    await insertRuntimeAudit(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "process_task.completion_accepted",
      resourceId: taskId,
      payload: { taskId, instanceId: task.instance_id, commandId, expectedRevision: task.revision },
    });
  });
  return { accepted: true as const, commandId, task: await getProcessTask(context, taskId) };
}

export type RuntimeWorkClaim = {
  workId: string;
  commandId: string;
  organizationId: string;
  instanceId: string;
  publicationId: string;
  commandType: "START" | "TASK_COMPLETE" | "JOB_COMPLETE" | "TIMER_FIRE" | "MESSAGE_CORRELATE";
  expectedRevision: number;
  fencingToken: number;
  deploymentHash: string;
  source: string;
  decisions: RuntimeDecisionSource[];
  envelope: RuntimeEnvelope | null;
  projectionSha256: string | null;
  variables: RuntimeVariables;
  targetTask: { id: string; executionId: string } | null;
  targetJob: { id: string; executionId: string; credentialId: string | null } | null;
  targetTimer: { id: string; executionId: string; elementId: string; elementName: string } | null;
  targetSubscription: { id: string; executionId: string; elementId: string; elementName: string } | null;
  output: RuntimeVariables;
  submission: RuntimeVariables;
  actorId: string;
};

export async function claimNextRuntimeWork(
  workerId: string,
  leaseSeconds = 30,
): Promise<RuntimeWorkClaim | null> {
  if (!workerId.trim()) throw new Error("workerId is required");
  return withTransaction(async (client) => {
    const claimed = await client.query<{
      id: string;
      organization_id: string;
      instance_id: string;
      command_id: string;
      fencing_token: string;
    }>(
      `SELECT work.id, work.organization_id, work.instance_id, work.command_id,
         work.fencing_token::text
       FROM durable_work work
       JOIN process_instances instance
         ON instance.id = work.instance_id AND instance.pending_command_id = work.command_id
       WHERE work.available_at <= now()
         AND (work.status = 'AVAILABLE' OR (work.status = 'CLAIMED' AND work.lease_expires_at < now()))
       ORDER BY work.available_at ASC, work.created_at ASC
       FOR UPDATE OF work SKIP LOCKED
       LIMIT 1`,
    );
    const work = claimed.rows[0];
    if (!work) return null;
    const nextToken = Number(work.fencing_token) + 1;
    await client.query(
      `UPDATE durable_work SET status = 'CLAIMED', claim_owner = $1,
         fencing_token = $2, lease_expires_at = now() + ($3 * interval '1 second'),
         attempts = attempts + 1, updated_at = now()
       WHERE id = $4`,
      [workerId, nextToken, leaseSeconds, work.id],
    );
    const commandResult = await client.query<{
      type: "START" | "TASK_COMPLETE" | "JOB_COMPLETE" | "TIMER_FIRE" | "MESSAGE_CORRELATE";
      expected_revision: number;
      payload: { output?: RuntimeVariables; submission?: RuntimeVariables };
      target_task_id: string | null;
      target_job_id: string | null;
      target_timer_id: string | null;
      target_subscription_id: string | null;
      created_by: string;
      deployment_hash: string;
      source: string;
      envelope: RuntimeEnvelope | null;
      projection_sha256: string | null;
      revision: number;
      publication_id: string;
    }>(
      `SELECT command.type, command.expected_revision, command.payload,
         command.target_task_id, command.target_job_id, command.target_timer_id,
         command.target_subscription_id, command.created_by,
         deployment.bundle_sha256 AS deployment_hash, deployment.publication_id,
         revision.source, instance.envelope, instance.projection_sha256, instance.revision
       FROM runtime_commands command
       JOIN process_instances instance
         ON instance.id = command.instance_id AND instance.organization_id = command.organization_id
       JOIN deployments deployment
         ON deployment.id = instance.deployment_id AND deployment.organization_id = instance.organization_id
       JOIN artifact_versions version ON version.id = instance.artifact_version_id
       JOIN artifact_revisions revision
         ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
       WHERE command.id = $1 AND command.organization_id = $2
       FOR UPDATE OF command, instance`,
      [work.command_id, work.organization_id],
    );
    const command = commandResult.rows[0];
    if (!command || command.revision !== command.expected_revision) {
      await client.query(
        `UPDATE durable_work SET status = 'QUARANTINED', claim_owner = NULL,
           lease_expires_at = NULL, updated_at = now() WHERE id = $1`,
        [work.id],
      );
      return null;
    }
    await client.query(
      `UPDATE runtime_commands SET status = 'CLAIMED', fencing_token = $1 WHERE id = $2`,
      [nextToken, work.command_id],
    );
    await client.query(
      `UPDATE process_instances SET active_fencing_token = $1 WHERE id = $2`,
      [nextToken, work.instance_id],
    );
    const [variablesResult, targetTaskResult, targetJobResult, targetTimerResult, targetSubscriptionResult, decisionResult] = await Promise.all([
      client.query<{ variables: RuntimeVariables }>(
        `SELECT variables FROM process_variable_snapshots
         WHERE instance_id = $1 AND checkpoint_revision = $2`,
        [work.instance_id, command.revision],
      ),
      command.target_task_id
        ? client.query<{ id: string; execution_id: string }>(
            `SELECT id, execution_id FROM process_tasks
             WHERE id = $1 AND instance_id = $2 AND status = 'OPEN'`,
            [command.target_task_id, work.instance_id],
          )
        : Promise.resolve({ rows: [] as Array<{ id: string; execution_id: string }> }),
      command.target_job_id
        ? client.query<{ id: string; execution_id: string; completed_by_credential_id: string | null }>(
            `SELECT id, execution_id, completed_by_credential_id FROM process_jobs
             WHERE id = $1 AND instance_id = $2 AND status = 'WAITING'`,
            [command.target_job_id, work.instance_id],
          )
        : Promise.resolve({ rows: [] as Array<{ id: string; execution_id: string; completed_by_credential_id: string | null }> }),
      command.target_timer_id
        ? client.query<{ id: string; execution_id: string; element_id: string; element_name: string }>(
            `SELECT id, execution_id, element_id, element_name FROM process_timers
             WHERE id = $1 AND instance_id = $2 AND status = 'WAITING'`,
            [command.target_timer_id, work.instance_id],
          )
        : Promise.resolve({ rows: [] as Array<{ id: string; execution_id: string; element_id: string; element_name: string }> }),
      command.target_subscription_id
        ? client.query<{ id: string; execution_id: string; element_id: string; element_name: string }>(
            `SELECT id, execution_id, element_id, element_name FROM message_subscriptions
             WHERE id = $1 AND instance_id = $2 AND status = 'WAITING'`,
            [command.target_subscription_id, work.instance_id],
          )
        : Promise.resolve({ rows: [] as Array<{ id: string; execution_id: string; element_id: string; element_name: string }> }),
      client.query<{ key: string; artifact_version_id: string; content_sha256: string; source: string }>(
        `SELECT artifact.key, version.id AS artifact_version_id,
           revision.content_sha256, revision.source
         FROM artifact_versions version
         JOIN artifacts artifact
           ON artifact.id = version.artifact_id AND artifact.organization_id = version.organization_id
         JOIN artifact_revisions revision
           ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
         WHERE version.publication_id = $1 AND version.organization_id = $2
           AND artifact.type = 'DMN_DECISION'
         ORDER BY artifact.key`,
        [command.publication_id, work.organization_id],
      ),
    ]);
    const targetTask = targetTaskResult.rows[0];
    const targetJob = targetJobResult.rows[0];
    const targetTimer = targetTimerResult.rows[0];
    const targetSubscription = targetSubscriptionResult.rows[0];
    return {
      workId: work.id,
      commandId: work.command_id,
      organizationId: work.organization_id,
      instanceId: work.instance_id,
      publicationId: command.publication_id,
      commandType: command.type,
      expectedRevision: command.expected_revision,
      fencingToken: nextToken,
      deploymentHash: command.deployment_hash,
      source: command.source,
      decisions: decisionResult.rows.map((decision) => ({
        key: decision.key,
        artifactVersionId: decision.artifact_version_id,
        contentSha256: decision.content_sha256,
        source: decision.source,
      })),
      envelope: command.envelope,
      projectionSha256: command.projection_sha256,
      variables: variablesResult.rows[0]?.variables ?? {},
      targetTask: targetTask ? { id: targetTask.id, executionId: targetTask.execution_id } : null,
      targetJob: targetJob ? { id: targetJob.id, executionId: targetJob.execution_id, credentialId: targetJob.completed_by_credential_id } : null,
      targetTimer: targetTimer ? {
        id: targetTimer.id,
        executionId: targetTimer.execution_id,
        elementId: targetTimer.element_id,
        elementName: targetTimer.element_name,
      } : null,
      targetSubscription: targetSubscription ? {
        id: targetSubscription.id,
        executionId: targetSubscription.execution_id,
        elementId: targetSubscription.element_id,
        elementName: targetSubscription.element_name,
      } : null,
      output: command.payload.output ?? {},
      submission: command.payload.submission ?? command.payload.output ?? {},
      actorId: command.created_by,
    };
  });
}

export async function assertRuntimeClaimProjection(claim: RuntimeWorkClaim) {
  if (claim.expectedRevision === 0) return;
  const [tasks, jobs, timers, messageSubscriptions] = await Promise.all([getPool().query<ProjectionTask & {
    checkpoint_assignee_id: string | null;
    candidate_group_key: string | null;
    execution_id: string;
    element_id: string;
    element_name: string;
    form_key: string | null;
    form_schema_sha256: string | null;
    input_mapping: Record<string, string> | null;
    output_mapping: Record<string, string> | null;
  }>(
    `SELECT task.id, task.element_id, task.element_name, task.execution_id,
       task.checkpoint_assignee_id, candidate_group.key AS candidate_group_key,
       task.form_key, task.form_schema_sha256, task.input_mapping, task.output_mapping
     FROM process_tasks task
     LEFT JOIN work_groups candidate_group
       ON candidate_group.id = task.candidate_group_id AND candidate_group.organization_id = task.organization_id
     WHERE task.instance_id = $1 AND task.status = 'OPEN' ORDER BY task.id`,
    [claim.instanceId],
  ), getPool().query<{
    id: string;
    element_id: string;
    element_name: string;
    execution_id: string;
    job_type: string;
    input: JsonObject;
    headers: Record<string, null | boolean | number | string>;
    output_mapping: Record<string, string>;
    lock_duration_seconds: number;
    max_attempts: number;
    retry_backoff_seconds: number;
    effect_key: string;
  }>(
    `SELECT id, element_id, element_name, execution_id, job_type, input, headers,
       output_mapping, lock_duration_seconds, max_attempts, retry_backoff_seconds, effect_key
     FROM process_jobs WHERE instance_id = $1 AND status = 'WAITING' ORDER BY id`,
    [claim.instanceId],
  ), getPool().query<{
    id: string;
    element_id: string;
    element_name: string;
    execution_id: string;
    timer_type: "DURATION" | "DATE";
    expression: string;
    duration_milliseconds: string | null;
    due_at: Date;
  }>(
    `SELECT id, element_id, element_name, execution_id, timer_type, expression,
       duration_milliseconds::text, due_at
     FROM process_timers WHERE instance_id = $1 AND status = 'WAITING' ORDER BY id`,
    [claim.instanceId],
  ), getPool().query<{
    id: string;
    element_id: string;
    element_name: string;
    execution_id: string;
    message_name: string;
    correlation_key: string;
  }>(
    `SELECT id, element_id, element_name, execution_id, message_name, correlation_key
     FROM message_subscriptions WHERE instance_id = $1 AND status = 'WAITING' ORDER BY id`,
    [claim.instanceId],
  )]);
  const projection = runtimeProjectionSha256({
    status: "WAITING",
    variables: claim.variables,
    tasks: tasks.rows.map((task) => ({
      id: task.id,
      elementId: task.element_id,
      elementName: task.element_name,
      executionId: task.execution_id,
      assigneeId: task.checkpoint_assignee_id,
      candidateGroupKey: task.candidate_group_key,
      formKey: task.form_key,
      formSchemaSha256: task.form_schema_sha256,
      inputMapping: task.input_mapping,
      outputMapping: task.output_mapping,
    })),
    jobs: jobs.rows.map((job) => ({
      id: job.id,
      elementId: job.element_id,
      elementName: job.element_name,
      executionId: job.execution_id,
      jobType: job.job_type,
      input: job.input,
      headers: job.headers,
      outputMapping: job.output_mapping,
      lockDurationSeconds: job.lock_duration_seconds,
      maxAttempts: job.max_attempts,
      retryBackoffSeconds: job.retry_backoff_seconds,
      effectKey: job.effect_key,
    })),
    timers: timers.rows.map((timer) => ({
      id: timer.id,
      elementId: timer.element_id,
      elementName: timer.element_name,
      executionId: timer.execution_id,
      timerType: timer.timer_type,
      expression: timer.expression,
      durationMilliseconds: timer.duration_milliseconds === null ? null : Number(timer.duration_milliseconds),
      dueAt: timer.due_at.toISOString(),
    })),
    messageSubscriptions: messageSubscriptions.rows.map((subscription) => ({
      id: subscription.id,
      elementId: subscription.element_id,
      elementName: subscription.element_name,
      executionId: subscription.execution_id,
      messageName: subscription.message_name,
      correlationKey: subscription.correlation_key,
    })),
  });
  if (projection !== claim.projectionSha256) {
    throw new RuntimePolicyError(
      "PROJECTION_HASH_MISMATCH",
      "The normalized runtime state does not match the persisted engine checkpoint.",
    );
  }
}

export async function commitRuntimeWork(
  claim: RuntimeWorkClaim,
  result: RuntimeAdvanceResult,
): Promise<boolean> {
  const revision = claim.expectedRevision + 1;
  const instanceScope = await getPool().query<{ workspace_id: string }>(
    `SELECT project.workspace_id
     FROM process_instances instance
     JOIN projects project
       ON project.id = instance.project_id AND project.organization_id = instance.organization_id
     WHERE instance.id = $1 AND instance.organization_id = $2`,
    [claim.instanceId, claim.organizationId],
  );
  if (!instanceScope.rows[0]) throw new ResourceNotFoundError("process instance");
  const workspaceId = instanceScope.rows[0].workspace_id;
  const tasks = await Promise.all(result.waits.filter((wait) => wait.kind === "USER_TASK").map(async (wait) => {
    let assigneeId: string | null = null;
    let candidateGroupId: string | null = null;
    let candidateGroupKey: string | null = null;
    if (wait.assignmentBinding.kind === "STARTER") {
      assigneeId = claim.actorId;
    } else if (wait.assignmentBinding.kind === "PERSON") {
      const person = await getPool().query<{ id: string }>(
        `SELECT DISTINCT principal.id
         FROM principals principal
         JOIN organization_memberships membership
           ON membership.principal_id = principal.id AND membership.organization_id = principal.organization_id
         WHERE principal.organization_id = $1 AND lower(principal.email) = lower($2)
           AND (membership.workspace_id IS NULL OR membership.workspace_id = $3)
         LIMIT 1`,
        [claim.organizationId, wait.assignmentBinding.email, workspaceId],
      );
      if (!person.rows[0]) {
        throw new RuntimePolicyError(
          "TASK_ASSIGNEE_NOT_FOUND",
          `User task ${wait.elementName} targets a person who is not a member of this workspace.`,
        );
      }
      assigneeId = person.rows[0].id;
    } else {
      const group = await getPool().query<{ id: string; key: string }>(
        `SELECT id, key FROM work_groups
         WHERE organization_id = $1 AND workspace_id = $2 AND key = $3`,
        [claim.organizationId, workspaceId, wait.assignmentBinding.groupKey],
      );
      if (!group.rows[0]) {
        throw new RuntimePolicyError(
          "TASK_GROUP_NOT_FOUND",
          `User task ${wait.elementName} targets a team queue that does not exist in this workspace.`,
        );
      }
      candidateGroupId = group.rows[0].id;
      candidateGroupKey = group.rows[0].key;
    }
    const base = {
      id: deterministicUuid(`${claim.instanceId}:${revision}:${wait.executionId}`),
      elementId: wait.elementId,
      elementName: wait.elementName,
      executionId: wait.executionId,
      assigneeId,
      checkpointAssigneeId: assigneeId,
      candidateGroupId,
      candidateGroupKey,
    };
    if (!wait.formBinding) {
      return {
        ...base,
        formKey: null,
        formVersionId: null,
        formSchema: null,
        formSchemaSha256: null,
        formData: null,
        inputMapping: null,
        outputMapping: null,
      };
    }
    const resolved = await getPool().query<{
      version_id: string;
      source: string;
      content_sha256: string;
    }>(
      `SELECT version.id AS version_id, revision.source, revision.content_sha256
       FROM artifact_versions version
       JOIN artifacts artifact
         ON artifact.id = version.artifact_id AND artifact.organization_id = version.organization_id
       JOIN artifact_revisions revision
         ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
       WHERE version.publication_id = $1 AND version.organization_id = $2
         AND artifact.type = 'FORM' AND artifact.key = $3`,
      [claim.publicationId, claim.organizationId, wait.formBinding.formKey],
    );
    if (resolved.rows.length !== 1) {
      throw new RuntimePolicyError(
        "DEPLOYED_FORM_NOT_FOUND",
        `The immutable deployment does not contain form ${wait.formBinding.formKey}.`,
      );
    }
    const formSchema = parseFormSource(resolved.rows[0].source) as unknown as JsonObject;
    const formData: JsonObject = {};
    for (const [formFieldKey, variableKey] of Object.entries(wait.formBinding.inputMapping)) {
      if (Object.hasOwn(result.variables, variableKey)) formData[formFieldKey] = result.variables[variableKey];
    }
    return {
      ...base,
      formKey: wait.formBinding.formKey,
      formVersionId: resolved.rows[0].version_id,
      formSchema,
      formSchemaSha256: resolved.rows[0].content_sha256,
      formData,
      inputMapping: wait.formBinding.inputMapping,
      outputMapping: wait.formBinding.outputMapping,
    };
  }));
  const projectionTasks: ProjectionTask[] = tasks.map((task) => ({
    id: task.id,
    elementId: task.elementId,
    elementName: task.elementName,
    executionId: task.executionId,
    assigneeId: task.assigneeId,
    candidateGroupKey: task.candidateGroupKey,
    formKey: task.formKey,
    formSchemaSha256: task.formSchemaSha256,
    inputMapping: task.inputMapping,
    outputMapping: task.outputMapping,
  }));
  const jobs: ProjectionJob[] = result.waits
    .filter((wait) => wait.kind === "EXTERNAL_JOB")
    .map((wait) => {
      const input: JsonObject = {};
      for (const [inputKey, variableKey] of Object.entries(wait.jobBinding.inputMapping)) {
        if (Object.hasOwn(result.variables, variableKey)) input[inputKey] = result.variables[variableKey];
      }
      const id = deterministicUuid(`${claim.instanceId}:${revision}:${wait.executionId}:job`);
      return {
        id,
        elementId: wait.elementId,
        elementName: wait.elementName,
        executionId: wait.executionId,
        jobType: wait.jobBinding.jobType,
        input,
        headers: wait.jobBinding.headers,
        outputMapping: wait.jobBinding.outputMapping,
        lockDurationSeconds: wait.jobBinding.lockDurationSeconds,
        maxAttempts: wait.jobBinding.maxAttempts,
        retryBackoffSeconds: wait.jobBinding.retryBackoffSeconds,
        effectKey: sha256({ instanceId: claim.instanceId, elementId: wait.elementId, executionId: wait.executionId }),
      };
    });
  const timerAnchor = Date.now();
  const timers: ProjectionTimer[] = result.waits
    .filter((wait) => wait.kind === "TIMER")
    .map((wait) => ({
      id: deterministicUuid(`${claim.instanceId}:${revision}:${wait.executionId}:timer`),
      elementId: wait.elementId,
      elementName: wait.elementName,
      executionId: wait.executionId,
      timerType: wait.timerBinding.timerType,
      expression: wait.timerBinding.expression,
      durationMilliseconds: wait.timerBinding.durationMilliseconds,
      dueAt: wait.timerBinding.timerType === "DATE"
        ? wait.timerBinding.dueAt!
        : new Date(timerAnchor + wait.timerBinding.durationMilliseconds!).toISOString(),
    }));
  const messageSubscriptions: ProjectionMessageSubscription[] = result.waits
    .filter((wait) => wait.kind === "MESSAGE")
    .map((wait) => {
      const value = result.variables[wait.messageBinding.correlationKeyVariable];
      if (
        !(
          (typeof value === "string" && value.trim().length > 0) ||
          (typeof value === "number" && Number.isFinite(value))
        )
      ) {
        throw new RuntimePolicyError(
          "MESSAGE_CORRELATION_VALUE_REQUIRED",
          `Message ${wait.messageBinding.messageName} requires a non-empty string or finite number in variable ${wait.messageBinding.correlationKeyVariable}.`,
        );
      }
      const correlationKey = String(value);
      if (correlationKey.length > 255) {
        throw new RuntimePolicyError(
          "MESSAGE_CORRELATION_VALUE_TOO_LONG",
          `Message ${wait.messageBinding.messageName} resolved a correlation key longer than 255 characters.`,
        );
      }
      return {
        id: deterministicUuid(`${claim.instanceId}:${revision}:${wait.executionId}:message`),
        elementId: wait.elementId,
        elementName: wait.elementName,
        executionId: wait.executionId,
        messageName: wait.messageBinding.messageName,
        correlationKey,
      };
    });
  const messageDeliveries = result.messageDeliveries.map((delivery) => {
    const value = result.variables[delivery.messageBinding.correlationKeyVariable];
    if (
      !(
        (typeof value === "string" && value.trim().length > 0) ||
        (typeof value === "number" && Number.isFinite(value))
      )
    ) {
      throw new RuntimePolicyError(
        "MESSAGE_CORRELATION_VALUE_REQUIRED",
        `Message ${delivery.messageBinding.messageName} requires a non-empty string or finite number in variable ${delivery.messageBinding.correlationKeyVariable}.`,
      );
    }
    const correlationKey = String(value);
    if (correlationKey.length > 255) {
      throw new RuntimePolicyError(
        "MESSAGE_CORRELATION_VALUE_TOO_LONG",
        `Message ${delivery.messageBinding.messageName} resolved a correlation key longer than 255 characters.`,
      );
    }
    const payload: JsonObject = {};
    for (const [payloadKey, variableKey] of Object.entries(delivery.messageBinding.payloadMapping)) {
      if (Object.hasOwn(result.variables, variableKey)) payload[payloadKey] = result.variables[variableKey];
    }
    return {
      id: deterministicUuid(`${claim.instanceId}:${revision}:${delivery.executionId}:message-delivery`),
      elementId: delivery.elementId,
      elementName: delivery.elementName,
      executionId: delivery.executionId,
      messageName: delivery.messageBinding.messageName,
      correlationKey,
      payload,
    };
  });
  const projectionSha256 = runtimeProjectionSha256({
    status: result.status,
    variables: result.variables,
    tasks: projectionTasks,
    jobs,
    timers,
    messageSubscriptions,
  });
  const envelope = {
    ...result.envelope,
    instanceId: claim.instanceId,
    instanceRevision: revision,
    projectionSha256,
  };
  const envelopeSha256 = sha256(envelope);

  return withTransaction(async (client) => {
    const current = result.waits[0];
    const updated = await client.query(
      `UPDATE process_instances SET revision = $1, status = $2,
         current_element_id = $3, current_element_name = $4,
         envelope = $5::jsonb, envelope_sha256 = $6, projection_sha256 = $7,
         adapter_name = $8, adapter_version = $9, engine_version = $10,
         pending_command_id = NULL, updated_at = now(),
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE NULL END
       WHERE id = $11 AND organization_id = $12 AND revision = $13
         AND pending_command_id = $14 AND active_fencing_token = $15`,
      [
        revision,
        result.status,
        current?.elementId ?? null,
        current?.elementName ?? null,
        JSON.stringify(envelope),
        envelopeSha256,
        projectionSha256,
        result.envelope.adapter.name,
        result.envelope.adapter.adapterVersion,
        result.envelope.adapter.engineVersion,
        claim.instanceId,
        claim.organizationId,
        claim.expectedRevision,
        claim.commandId,
        claim.fencingToken,
      ],
    );
    if (!updated.rowCount) return false;

    if (claim.targetTask) {
      await client.query(
        `UPDATE process_tasks SET status = 'COMPLETED', submission = $1::jsonb,
           completed_by = $2, completed_at = now()
         WHERE id = $3 AND instance_id = $4 AND status = 'OPEN'`,
        [JSON.stringify(claim.submission), claim.actorId, claim.targetTask.id, claim.instanceId],
      );
    }
    if (claim.targetJob) {
      await client.query(
        `UPDATE process_jobs SET status = 'COMPLETED', result = $1::jsonb,
           completed_at = now()
         WHERE id = $2 AND instance_id = $3 AND status = 'WAITING'`,
        [JSON.stringify(claim.submission), claim.targetJob.id, claim.instanceId],
      );
    }
    if (claim.targetTimer) {
      await client.query(
        `UPDATE process_timers SET status = 'FIRED', fired_at = now()
         WHERE id = $1 AND instance_id = $2 AND status = 'WAITING'`,
        [claim.targetTimer.id, claim.instanceId],
      );
    }
    if (claim.targetSubscription) {
      await client.query(
        `UPDATE message_subscriptions SET status = 'CONSUMED', payload = $1::jsonb,
           consumed_at = now()
         WHERE id = $2 AND instance_id = $3 AND status = 'WAITING'`,
        [JSON.stringify(claim.submission), claim.targetSubscription.id, claim.instanceId],
      );
    }
    for (const task of tasks) {
      await client.query(
        `INSERT INTO process_tasks
          (id, organization_id, instance_id, checkpoint_revision, element_id,
           element_name, execution_id, status, assignee_id, checkpoint_assignee_id,
           candidate_group_id, form_key,
           form_version_id, form_schema, form_schema_sha256, form_data,
           input_mapping, output_mapping)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9, $10, $11, $12,
           $13::jsonb, $14, $15::jsonb, $16::jsonb, $17::jsonb)`,
        [
          task.id,
          claim.organizationId,
          claim.instanceId,
          revision,
          task.elementId,
          task.elementName,
          task.executionId,
          task.assigneeId,
          task.checkpointAssigneeId,
          task.candidateGroupId,
          task.formKey,
          task.formVersionId,
          task.formSchema ? JSON.stringify(task.formSchema) : null,
          task.formSchemaSha256,
          task.formData ? JSON.stringify(task.formData) : null,
          task.inputMapping ? JSON.stringify(task.inputMapping) : null,
          task.outputMapping ? JSON.stringify(task.outputMapping) : null,
        ],
      );
      const recipients = task.assigneeId
        ? [task.assigneeId]
        : task.candidateGroupId
          ? (await client.query<{ principal_id: string }>(
              `SELECT principal_id FROM work_group_members
               WHERE organization_id = $1 AND group_id = $2`,
              [claim.organizationId, task.candidateGroupId],
            )).rows.map((row) => row.principal_id)
          : [];
      for (const recipientId of recipients) {
        await insertNotification(client, {
          organizationId: claim.organizationId,
          recipientId,
          actorId: claim.actorId,
          kind: "TASK_AVAILABLE",
          title: task.candidateGroupKey ? `New work · ${task.candidateGroupKey}` : "New work assigned",
          body: task.elementName,
          href: `/work?task=${task.id}`,
          resourceType: "process-task",
          resourceId: task.id,
          dedupeKey: `task:${task.id}:available:${recipientId}`,
        });
      }
    }
    for (const job of jobs) {
      await client.query(
        `INSERT INTO process_jobs
          (id, organization_id, instance_id, checkpoint_revision, element_id,
           element_name, execution_id, job_type, input, headers, output_mapping,
           lock_duration_seconds, max_attempts, retry_backoff_seconds, effect_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
           $11::jsonb, $12, $13, $14, $15, 'WAITING')`,
        [job.id, claim.organizationId, claim.instanceId, revision, job.elementId,
          job.elementName, job.executionId, job.jobType, JSON.stringify(job.input),
          JSON.stringify(job.headers), JSON.stringify(job.outputMapping), job.lockDurationSeconds,
          job.maxAttempts, job.retryBackoffSeconds, job.effectKey],
      );
      await client.query(
        `INSERT INTO external_job_deliveries
          (organization_id, job_id, attempt, retry_cycle, cycle_attempt, status)
         VALUES ($1, $2, 1, 1, 1, 'AVAILABLE')`,
        [claim.organizationId, job.id],
      );
    }
    for (const timer of timers) {
      await client.query(
        `INSERT INTO process_timers
          (id, organization_id, instance_id, checkpoint_revision, element_id,
           element_name, execution_id, timer_type, expression,
           duration_milliseconds, due_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'WAITING')`,
        [timer.id, claim.organizationId, claim.instanceId, revision, timer.elementId,
          timer.elementName, timer.executionId, timer.timerType, timer.expression,
          timer.durationMilliseconds, timer.dueAt],
      );
    }
    for (const subscription of messageSubscriptions) {
      await client.query(
        `INSERT INTO message_subscriptions
          (id, organization_id, instance_id, checkpoint_revision, element_id,
           element_name, execution_id, message_name, correlation_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'WAITING')`,
        [subscription.id, claim.organizationId, claim.instanceId, revision,
          subscription.elementId, subscription.elementName, subscription.executionId,
          subscription.messageName, subscription.correlationKey],
      );
    }
    for (const delivery of messageDeliveries) {
      await client.query(
        `INSERT INTO message_deliveries
          (id, organization_id, instance_id, environment_id, checkpoint_revision,
           element_id, element_name, execution_id, message_name, correlation_key,
           payload, status, created_by)
         SELECT $1, $2, instance.id, instance.environment_id, $3, $4, $5, $6,
           $7, $8, $9::jsonb, 'AVAILABLE', $10
         FROM process_instances instance
         WHERE instance.id = $11 AND instance.organization_id = $2`,
        [delivery.id, claim.organizationId, revision, delivery.elementId,
          delivery.elementName, delivery.executionId, delivery.messageName,
          delivery.correlationKey, JSON.stringify(delivery.payload), claim.actorId,
          claim.instanceId],
      );
    }
    const decisionEvidence = result.decisionEvaluations.map((evaluation) => ({
      ...evaluation,
      id: deterministicUuid(`${claim.instanceId}:${revision}:${evaluation.executionId}:decision`),
      requestSha256: sha256({
        instanceId: claim.instanceId,
        revision,
        elementId: evaluation.elementId,
        decisionContentSha256: evaluation.decisionContentSha256,
        input: evaluation.input,
      }),
    }));
    for (const evaluation of decisionEvidence) {
      await client.query(
        `INSERT INTO decision_evaluations
          (id, organization_id, project_id, environment_id, deployment_id, publication_id,
           decision_artifact_version_id, decision_key, decision_id, decision_name, hit_policy,
           input, output, matched_rule_ids, outcome, request_sha256,
           source_instance_id, source_element_id, source_element_name, checkpoint_revision, created_by)
         SELECT $1, instance.organization_id, instance.project_id, instance.environment_id,
           instance.deployment_id, deployment.publication_id, $2, $3, $4, $5, $6,
           $7::jsonb, $8::jsonb, $9::text[], $10, $11,
           instance.id, $12, $13, $14, $15
         FROM process_instances instance
         JOIN deployments deployment
           ON deployment.id = instance.deployment_id AND deployment.organization_id = instance.organization_id
         WHERE instance.id = $16 AND instance.organization_id = $17`,
        [
          evaluation.id,
          evaluation.decisionArtifactVersionId,
          evaluation.decisionKey,
          evaluation.decisionId,
          evaluation.decisionName,
          evaluation.hitPolicy,
          JSON.stringify(evaluation.input),
          evaluation.output === null ? null : JSON.stringify(evaluation.output),
          evaluation.matchedRuleIds,
          evaluation.output === null ? "NO_MATCH" : "MATCHED",
          evaluation.requestSha256,
          evaluation.elementId,
          evaluation.elementName,
          revision,
          claim.actorId,
          claim.instanceId,
          claim.organizationId,
        ],
      );
    }
    await client.query(
      `INSERT INTO process_variable_snapshots
        (instance_id, organization_id, checkpoint_revision, variables)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [claim.instanceId, claim.organizationId, revision, JSON.stringify(result.variables)],
    );
    await client.query(
      `INSERT INTO process_checkpoints
        (instance_id, organization_id, revision, status, envelope,
         envelope_sha256, projection_sha256, command_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [claim.instanceId, claim.organizationId, revision, result.status, JSON.stringify(envelope), envelopeSha256, projectionSha256, claim.commandId],
    );

    const sequenceResult = await client.query<{ sequence: number }>(
      `SELECT (coalesce(max(sequence), 0) + 1)::integer AS sequence
       FROM execution_events WHERE instance_id = $1`,
      [claim.instanceId],
    );
    let sequence = sequenceResult.rows[0].sequence;
    const events: Array<{
      type: string;
      elementId?: string;
      elementName?: string;
      actorId?: string;
      data?: JsonObject;
    }> = [];
    if (claim.commandType === "START") {
      events.push({ type: "PROCESS_STARTED", actorId: claim.actorId, data: { deploymentHash: claim.deploymentHash } });
    }
    if (claim.commandType === "TASK_COMPLETE" && claim.targetTask) {
      events.push({
        type: "TASK_COMPLETED",
        elementId: result.events.find((event) => event.type === "ACTIVITY_COMPLETED")?.elementId,
        elementName: result.events.find((event) => event.type === "ACTIVITY_COMPLETED")?.elementName,
        actorId: claim.actorId,
        data: { taskId: claim.targetTask.id, output: claim.output },
      });
    }
    if (claim.commandType === "JOB_COMPLETE" && claim.targetJob) {
      events.push({
        type: "JOB_COMPLETED",
        elementId: result.events.find((event) => event.type === "ACTIVITY_COMPLETED")?.elementId,
        elementName: result.events.find((event) => event.type === "ACTIVITY_COMPLETED")?.elementName,
        actorId: claim.actorId,
        data: { jobId: claim.targetJob.id, output: claim.output },
      });
    }
    if (claim.commandType === "TIMER_FIRE" && claim.targetTimer) {
      events.push({
        type: "TIMER_FIRED",
        elementId: claim.targetTimer.elementId,
        elementName: claim.targetTimer.elementName,
        data: { timerId: claim.targetTimer.id },
      });
    }
    if (claim.commandType === "MESSAGE_CORRELATE" && claim.targetSubscription) {
      events.push({
        type: "MESSAGE_CORRELATED",
        elementId: claim.targetSubscription.elementId,
        elementName: claim.targetSubscription.elementName,
        actorId: claim.actorId,
        data: { subscriptionId: claim.targetSubscription.id, payload: claim.submission },
      });
    }
    for (const event of result.events) {
      events.push({
        type: event.type === "ACTIVITY_ENTERED" ? "ELEMENT_ENTERED" : "ELEMENT_COMPLETED",
        elementId: event.elementId,
        elementName: event.elementName,
        data: { elementType: event.elementType },
      });
    }
    for (const task of tasks) {
      events.push({
        type: "TASK_AVAILABLE",
        elementId: task.elementId,
        elementName: task.elementName,
        data: {
          taskId: task.id,
          assigneeId: task.assigneeId,
          candidateGroupKey: task.candidateGroupKey,
        },
      });
    }
    for (const job of jobs) {
      events.push({
        type: "JOB_AVAILABLE",
        elementId: job.elementId,
        elementName: job.elementName,
        data: { jobId: job.id, jobType: job.jobType, effectKey: job.effectKey },
      });
    }
    for (const timer of timers) {
      events.push({
        type: "TIMER_SCHEDULED",
        elementId: timer.elementId,
        elementName: timer.elementName,
        data: {
          timerId: timer.id,
          timerType: timer.timerType,
          expression: timer.expression,
          dueAt: timer.dueAt,
        },
      });
    }
    for (const subscription of messageSubscriptions) {
      events.push({
        type: "MESSAGE_SUBSCRIBED",
        elementId: subscription.elementId,
        elementName: subscription.elementName,
        data: {
          subscriptionId: subscription.id,
          messageName: subscription.messageName,
          correlationKey: subscription.correlationKey,
        },
      });
    }
    for (const delivery of messageDeliveries) {
      events.push({
        type: "MESSAGE_QUEUED",
        elementId: delivery.elementId,
        elementName: delivery.elementName,
        data: {
          deliveryId: delivery.id,
          messageName: delivery.messageName,
          correlationKey: delivery.correlationKey,
        },
      });
    }
    for (const evaluation of decisionEvidence) {
      events.push({
        type: "DECISION_EVALUATED",
        elementId: evaluation.elementId,
        elementName: evaluation.elementName,
        data: {
          evaluationId: evaluation.id,
          decisionKey: evaluation.decisionKey,
          decisionId: evaluation.decisionId,
          decisionName: evaluation.decisionName,
          hitPolicy: evaluation.hitPolicy,
          matchedRuleIds: evaluation.matchedRuleIds,
          outcome: evaluation.output === null ? "NO_MATCH" : "MATCHED",
          input: evaluation.input,
          output: evaluation.output,
        },
      });
    }
    if (result.status === "COMPLETED") {
      events.push({ type: "PROCESS_COMPLETED", data: { variables: result.variables } });
    }
    for (const event of events) {
      await client.query(
        `INSERT INTO execution_events
          (id, organization_id, instance_id, sequence, checkpoint_revision,
           type, element_id, element_name, actor_id, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [deterministicUuid(`${claim.instanceId}:${revision}:event:${sequence}`), claim.organizationId, claim.instanceId, sequence++, revision, event.type, event.elementId ?? null, event.elementName ?? null, event.actorId ?? null, JSON.stringify(event.data ?? {})],
      );
    }
    await client.query(
      `UPDATE runtime_commands SET status = 'APPLIED', applied_at = now()
       WHERE id = $1 AND fencing_token = $2`,
      [claim.commandId, claim.fencingToken],
    );
    await client.query(
      `UPDATE durable_work SET status = 'DONE', claim_owner = NULL,
         lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND fencing_token = $2`,
      [claim.workId, claim.fencingToken],
    );
    await client.query(
      `INSERT INTO outbox_events
        (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'process_instance.checkpointed', 'process_instance', $2, $3::jsonb)`,
      [claim.organizationId, claim.instanceId, JSON.stringify({ instanceId: claim.instanceId, commandId: claim.commandId, revision, status: result.status, projectionSha256 })],
    );
    return true;
  });
}

export async function failRuntimeWork(
  claim: RuntimeWorkClaim,
  error: { code: string; message: string },
) {
  return withTransaction(async (client) => {
    const incidentId = randomUUID();
    const updated = await client.query(
      `UPDATE process_instances SET status = 'INCIDENT', pending_command_id = NULL,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND revision = $3
         AND pending_command_id = $4 AND active_fencing_token = $5`,
      [claim.instanceId, claim.organizationId, claim.expectedRevision, claim.commandId, claim.fencingToken],
    );
    if (!updated.rowCount) return false;
    await client.query(
      `UPDATE runtime_commands SET status = 'QUARANTINED' WHERE id = $1 AND fencing_token = $2`,
      [claim.commandId, claim.fencingToken],
    );
    await client.query(
      `UPDATE durable_work SET status = 'QUARANTINED', claim_owner = NULL,
         lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND fencing_token = $2`,
      [claim.workId, claim.fencingToken],
    );
    await client.query(
      `INSERT INTO runtime_incidents
        (id, organization_id, instance_id, command_id, timer_id, subscription_id, code, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [incidentId, claim.organizationId, claim.instanceId, claim.commandId,
        claim.targetTimer?.id ?? null, claim.targetSubscription?.id ?? null,
        error.code.slice(0, 120), error.message.slice(0, 4000)],
    );
    const scope = await client.query<{ workspace_id: string }>(
      `SELECT project.workspace_id
       FROM process_instances instance
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE instance.id = $1 AND instance.organization_id = $2`,
      [claim.instanceId, claim.organizationId],
    );
    if (scope.rows[0]) {
      await notifyWorkspaceRoles(client, {
        organizationId: claim.organizationId,
        workspaceId: scope.rows[0].workspace_id,
        roles: ["organization-owner", "workspace-admin", "operator"],
        actorId: claim.actorId,
        kind: "INCIDENT_OPENED",
        title: "Process needs attention",
        body: error.message.slice(0, 1000),
        href: `/operations/${claim.instanceId}`,
        resourceType: "runtime-incident",
        resourceId: incidentId,
        dedupeKey: `incident:${incidentId}:opened`,
      });
    }
    await client.query(
      `INSERT INTO outbox_events
        (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'process_instance.incident_opened', 'process_instance', $2, $3::jsonb)`,
      [claim.organizationId, claim.instanceId, JSON.stringify({ instanceId: claim.instanceId, commandId: claim.commandId, code: error.code })],
    );
    return true;
  });
}

async function insertRuntimeAudit(
  client: PoolClient,
  input: {
    organizationId: string;
    actorId: string;
    action: string;
    resourceId: string;
    payload: JsonObject;
  },
) {
  await client.query(
    `INSERT INTO audit_records
      (organization_id, actor_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, 'runtime', $4, $5::jsonb)`,
    [input.organizationId, input.actorId, input.action, input.resourceId, JSON.stringify(input.payload)],
  );
  await client.query(
    `INSERT INTO outbox_events
      (organization_id, type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, 'runtime', $3, $4::jsonb)`,
    [input.organizationId, input.action, input.resourceId, JSON.stringify(input.payload)],
  );
}
