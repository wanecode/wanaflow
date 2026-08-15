import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { assertPermission, assertProjectAccess } from "./authorization";
import { PermissionDeniedError, ResourceNotFoundError, RuntimePolicyError, RuntimeStateConflictError } from "./errors";
import { getPool, withTransaction } from "./pool";
import { insertNotification, notifyWorkspaceRoles } from "./notifications";
import type {
  ExternalJob,
  ExternalJobDelivery,
  JobWorkerContext,
  LockedExternalJob,
  PrincipalContext,
  WorkerCredential,
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
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}

function normalizeObject(input: unknown, label: string): JsonObject {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimePolicyError("INVALID_JOB_PAYLOAD", `${label} must be a JSON object.`);
  }
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
    throw new RuntimePolicyError("JOB_PAYLOAD_TOO_LARGE", `${label} exceeds the 1 MiB limit.`);
  }
  return JSON.parse(serialized) as JsonObject;
}

type CredentialRow = {
  id: string;
  project_id: string;
  name: string;
  token_prefix: string;
  created_by: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

function mapCredential(row: CredentialRow): WorkerCredential {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

export async function createWorkerCredential(
  context: PrincipalContext,
  input: { projectId: string; name: string },
) {
  assertPermission(context, "worker-credential:create");
  await assertProjectAccess(context, input.projectId);
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new RuntimePolicyError("INVALID_CREDENTIAL_NAME", "Credential name must be between 1 and 120 characters.");
  }
  const secret = `wf_job_${randomBytes(32).toString("base64url")}`;
  const credential = await withTransaction(async (client) => {
    const row = await client.query<CredentialRow>(
      `INSERT INTO worker_credentials
        (organization_id, project_id, name, token_prefix, token_sha256, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, name, token_prefix, created_by, created_at, last_used_at, revoked_at`,
      [context.organization.id, input.projectId, name, secret.slice(0, 16), sha256(secret), context.principal.id],
    );
    await insertAudit(client, context.organization.id, context.principal.id,
      "worker_credential.created", row.rows[0].id, { projectId: input.projectId, name, tokenPrefix: secret.slice(0, 16) });
    return mapCredential(row.rows[0]);
  });
  return { ...credential, token: secret };
}

export async function listWorkerCredentials(context: PrincipalContext, projectId?: string) {
  assertPermission(context, "worker-credential:read");
  const result = await getPool().query<CredentialRow>(
    `SELECT credential.id, credential.project_id, credential.name, credential.token_prefix,
       credential.created_by, credential.created_at, credential.last_used_at, credential.revoked_at
     FROM worker_credentials credential
     JOIN projects project
       ON project.id = credential.project_id AND project.organization_id = credential.organization_id
     WHERE credential.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND ($3::uuid IS NULL OR credential.project_id = $3)
     ORDER BY credential.created_at DESC`,
    [context.organization.id, context.workspaceScopeId, projectId ?? null],
  );
  return result.rows.map(mapCredential);
}

export async function revokeWorkerCredential(context: PrincipalContext, credentialId: string) {
  assertPermission(context, "worker-credential:revoke");
  return withTransaction(async (client) => {
    const result = await client.query<CredentialRow>(
      `UPDATE worker_credentials credential SET revoked_at = coalesce(revoked_at, now())
       FROM projects project
       WHERE credential.id = $1 AND credential.organization_id = $2
         AND project.id = credential.project_id AND project.organization_id = credential.organization_id
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       RETURNING credential.id, credential.project_id, credential.name, credential.token_prefix,
         credential.created_by, credential.created_at, credential.last_used_at, credential.revoked_at`,
      [credentialId, context.organization.id, context.workspaceScopeId],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("worker credential");
    await insertAudit(client, context.organization.id, context.principal.id,
      "worker_credential.revoked", credentialId, { projectId: result.rows[0].project_id });
    return mapCredential(result.rows[0]);
  });
}

export async function authenticateJobWorkerToken(token: string): Promise<JobWorkerContext> {
  if (!token.startsWith("wf_job_") || token.length < 32) throw new PermissionDeniedError("external-job:worker");
  const result = await getPool().query<{
    id: string;
    organization_id: string;
    project_id: string;
    created_by: string;
  }>(
    `UPDATE worker_credentials SET last_used_at = now()
     WHERE token_sha256 = $1 AND revoked_at IS NULL
     RETURNING id, organization_id, project_id, created_by`,
    [sha256(token)],
  );
  const credential = result.rows[0];
  if (!credential) throw new PermissionDeniedError("external-job:worker");
  return {
    organizationId: credential.organization_id,
    projectId: credential.project_id,
    credentialId: credential.id,
    createdBy: credential.created_by,
  };
}

type JobRow = {
  id: string;
  instance_id: string;
  process_name: string;
  business_key: string | null;
  checkpoint_revision: number;
  element_id: string;
  element_name: string;
  job_type: string;
  input: JsonObject;
  headers: Record<string, null | boolean | number | string>;
  effect_key: string;
  status: "WAITING" | "COMPLETED" | "CANCELLED";
  completion_pending: boolean;
  max_attempts: number;
  retry_backoff_seconds: number;
  created_at: Date;
  completed_at: Date | null;
};

type DeliveryRow = {
  id: string;
  job_id: string;
  attempt: number;
  retry_cycle: number;
  cycle_attempt: number;
  status: ExternalJobDelivery["status"];
  available_at: Date;
  worker_id: string | null;
  fencing_token: string;
  lock_expires_at: Date | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  finished_at: Date | null;
};

function mapDelivery(row: DeliveryRow): ExternalJobDelivery {
  return {
    id: row.id,
    attempt: row.attempt,
    retryCycle: row.retry_cycle,
    cycleAttempt: row.cycle_attempt,
    status: row.status,
    availableAt: row.available_at.toISOString(),
    workerId: row.worker_id,
    fencingToken: Number(row.fencing_token),
    lockExpiresAt: row.lock_expires_at?.toISOString() ?? null,
    failure: row.failure_code && row.failure_message ? { code: row.failure_code, message: row.failure_message } : null,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

function mapJob(row: JobRow, deliveries: DeliveryRow[]): ExternalJob {
  return {
    id: row.id,
    instanceId: row.instance_id,
    processName: row.process_name,
    businessKey: row.business_key,
    checkpointRevision: row.checkpoint_revision,
    elementId: row.element_id,
    elementName: row.element_name,
    jobType: row.job_type,
    input: row.input,
    headers: row.headers,
    effectKey: row.effect_key,
    status: row.status,
    completionPending: row.completion_pending,
    maxAttempts: row.max_attempts,
    retryBackoffSeconds: row.retry_backoff_seconds,
    deliveries: deliveries.filter((delivery) => delivery.job_id === row.id).map(mapDelivery),
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

const JOB_SELECT = `
  SELECT job.id, job.instance_id, instance.process_name, instance.business_key,
    job.checkpoint_revision, job.element_id, job.element_name, job.job_type,
    job.input, job.headers, job.effect_key,
    CASE WHEN instance.status = 'CANCELLED' AND job.status = 'WAITING'
      THEN 'CANCELLED' ELSE job.status END AS status,
    job.retry_backoff_seconds, job.created_at, job.completed_at,
    EXISTS (
      SELECT 1 FROM runtime_commands command
      WHERE command.id = instance.pending_command_id AND command.target_job_id = job.id
        AND command.status IN ('ACCEPTED', 'CLAIMED')
    ) AS completion_pending
  FROM process_jobs job
  JOIN process_instances instance
    ON instance.id = job.instance_id AND instance.organization_id = job.organization_id
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

async function deliveriesFor(jobIds: string[]) {
  if (!jobIds.length) return [];
  const result = await getPool().query<DeliveryRow>(
    `SELECT id, job_id, attempt, retry_cycle, cycle_attempt, status, available_at,
       worker_id, fencing_token::text, lock_expires_at, failure_code, failure_message,
       created_at, finished_at
     FROM external_job_deliveries WHERE job_id = ANY($1::uuid[])
     ORDER BY attempt DESC`,
    [jobIds],
  );
  return result.rows;
}

export async function listExternalJobs(context: PrincipalContext, input?: { instanceId?: string; status?: ExternalJob["status"] }) {
  assertPermission(context, "job:read");
  const result = await getPool().query<JobRow>(
    `${JOB_SELECT}
     WHERE job.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND ($3::uuid IS NULL OR job.instance_id = $3)
       AND ($4::text IS NULL OR job.status = $4)
     ORDER BY job.created_at DESC`,
    [context.organization.id, context.workspaceScopeId, input?.instanceId ?? null, input?.status ?? null],
  );
  const deliveries = await deliveriesFor(result.rows.map((job) => job.id));
  return result.rows.map((job) => mapJob(job, deliveries));
}

export async function getExternalJob(context: PrincipalContext, jobId: string) {
  assertPermission(context, "job:read");
  const result = await getPool().query<JobRow>(
    `${JOB_SELECT}
     WHERE job.id = $1 AND job.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [jobId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("external job");
  return mapJob(result.rows[0], await deliveriesFor([jobId]));
}

type LockRow = JobRow & {
  delivery_id: string;
  attempt: number;
  retry_cycle: number;
  cycle_attempt: number;
  fencing_token: string;
  lock_duration_seconds: number;
};

export async function lockExternalJobs(
  context: JobWorkerContext,
  input: { workerId: string; jobTypes: string[]; maxJobs?: number },
): Promise<LockedExternalJob[]> {
  const workerId = input.workerId.trim();
  const jobTypes = [...new Set(input.jobTypes.map((jobType) => jobType.trim()).filter(Boolean))];
  const maxJobs = Math.min(20, Math.max(1, input.maxJobs ?? 1));
  if (!workerId || workerId.length > 255 || !jobTypes.length || jobTypes.length > 50) {
    throw new RuntimePolicyError("INVALID_JOB_LOCK_REQUEST", "workerId and at least one valid job type are required.");
  }
  return withTransaction(async (client) => {
    const candidates = await client.query<LockRow>(
      `SELECT job.id, job.instance_id, instance.process_name, instance.business_key,
         job.checkpoint_revision, job.element_id, job.element_name, job.job_type,
         job.input, job.headers, job.effect_key, job.status,
         false AS completion_pending, job.max_attempts, job.retry_backoff_seconds,
         job.created_at, job.completed_at, job.lock_duration_seconds,
         delivery.id AS delivery_id, delivery.attempt, delivery.retry_cycle,
         delivery.cycle_attempt, delivery.fencing_token::text
       FROM external_job_deliveries delivery
       JOIN process_jobs job
         ON job.id = delivery.job_id AND job.organization_id = delivery.organization_id
       JOIN process_instances instance
         ON instance.id = job.instance_id AND instance.organization_id = job.organization_id
       WHERE delivery.organization_id = $1 AND instance.project_id = $2
         AND job.status = 'WAITING' AND instance.status = 'WAITING'
         AND instance.pending_command_id IS NULL AND job.job_type = ANY($3::text[])
         AND ((delivery.status = 'AVAILABLE' AND delivery.available_at <= now())
           OR (delivery.status = 'LOCKED' AND delivery.lock_expires_at < now()))
       ORDER BY delivery.available_at, delivery.created_at
       FOR UPDATE OF delivery, job, instance SKIP LOCKED
       LIMIT $4`,
      [context.organizationId, context.projectId, jobTypes, maxJobs],
    );
    const locked: LockedExternalJob[] = [];
    for (const row of candidates.rows) {
      const fencingToken = Number(row.fencing_token) + 1;
      const updated = await client.query<{ lock_expires_at: Date }>(
        `UPDATE external_job_deliveries SET status = 'LOCKED', worker_id = $1,
           credential_id = $2, fencing_token = $3,
           lock_expires_at = now() + ($4 * interval '1 second'), updated_at = now()
         WHERE id = $5
         RETURNING lock_expires_at`,
        [workerId, context.credentialId, fencingToken, row.lock_duration_seconds, row.delivery_id],
      );
      locked.push({
        id: row.id,
        instanceId: row.instance_id,
        processName: row.process_name,
        businessKey: row.business_key,
        elementId: row.element_id,
        elementName: row.element_name,
        jobType: row.job_type,
        input: row.input,
        headers: row.headers,
        effectKey: row.effect_key,
        deliveryId: row.delivery_id,
        attempt: row.attempt,
        retryCycle: row.retry_cycle,
        cycleAttempt: row.cycle_attempt,
        fencingToken,
        lockExpiresAt: updated.rows[0].lock_expires_at.toISOString(),
      });
    }
    return locked;
  });
}

type LockedDeliveryRow = {
  delivery_id: string;
  delivery_status: ExternalJobDelivery["status"];
  worker_id: string | null;
  credential_id: string | null;
  fencing_token: string;
  lock_expires_at: Date | null;
  attempt: number;
  retry_cycle: number;
  cycle_attempt: number;
  job_id: string;
  job_status: ExternalJob["status"];
  instance_id: string;
  instance_status: string;
  revision: number;
  checkpoint_revision: number;
  pending_command_id: string | null;
  output_mapping: Record<string, string>;
  max_attempts: number;
  retry_backoff_seconds: number;
};

async function lockedDelivery(client: PoolClient, context: JobWorkerContext, jobId: string, deliveryId: string) {
  const result = await client.query<LockedDeliveryRow>(
    `SELECT delivery.id AS delivery_id, delivery.status AS delivery_status,
       delivery.worker_id, delivery.credential_id, delivery.fencing_token::text,
       delivery.lock_expires_at, delivery.attempt, delivery.retry_cycle,
       delivery.cycle_attempt, job.id AS job_id, job.status AS job_status,
       job.instance_id, instance.status AS instance_status, instance.revision,
       job.checkpoint_revision, instance.pending_command_id, job.output_mapping,
       job.max_attempts, job.retry_backoff_seconds
     FROM external_job_deliveries delivery
     JOIN process_jobs job
       ON job.id = delivery.job_id AND job.organization_id = delivery.organization_id
     JOIN process_instances instance
       ON instance.id = job.instance_id AND instance.organization_id = job.organization_id
     WHERE job.id = $1 AND delivery.id = $2 AND job.organization_id = $3
       AND instance.project_id = $4
     FOR UPDATE OF delivery, job, instance`,
    [jobId, deliveryId, context.organizationId, context.projectId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("external job delivery");
  return result.rows[0];
}

function assertLease(row: LockedDeliveryRow, context: JobWorkerContext, workerId: string, fencingToken: number) {
  if (row.delivery_status !== "LOCKED" || row.worker_id !== workerId || row.credential_id !== context.credentialId ||
      Number(row.fencing_token) !== fencingToken || !row.lock_expires_at || row.lock_expires_at.getTime() <= Date.now()) {
    throw new RuntimeStateConflictError("The external-job lease is stale, expired, or owned by another worker.");
  }
}

export async function heartbeatExternalJob(
  context: JobWorkerContext,
  jobId: string,
  input: { deliveryId: string; workerId: string; fencingToken: number },
) {
  return withTransaction(async (client) => {
    const row = await lockedDelivery(client, context, jobId, input.deliveryId);
    assertLease(row, context, input.workerId, input.fencingToken);
    const nextToken = input.fencingToken + 1;
    const result = await client.query<{ lock_expires_at: Date }>(
      `UPDATE external_job_deliveries delivery SET fencing_token = $1,
         lock_expires_at = now() + (job.lock_duration_seconds * interval '1 second'),
         updated_at = now()
       FROM process_jobs job
       WHERE delivery.id = $2 AND job.id = delivery.job_id
       RETURNING delivery.lock_expires_at`,
      [nextToken, input.deliveryId],
    );
    return { jobId, deliveryId: input.deliveryId, fencingToken: nextToken, lockExpiresAt: result.rows[0].lock_expires_at.toISOString() };
  });
}

export async function completeExternalJob(
  context: JobWorkerContext,
  jobId: string,
  input: { deliveryId: string; workerId: string; fencingToken: number; result?: unknown; idempotencyKey?: string | null },
) {
  const rawResult = normalizeObject(input.result, "result");
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const requestSha256 = sha256({ type: "JOB_COMPLETE", jobId, deliveryId: input.deliveryId, result: rawResult });
  return withTransaction(async (client) => {
    const row = await lockedDelivery(client, context, jobId, input.deliveryId);
    if (row.delivery_status === "SUCCEEDED") {
      const existing = await client.query<{ id: string; request_sha256: string }>(
        `SELECT id, request_sha256 FROM runtime_commands
         WHERE target_job_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [jobId, context.organizationId],
      );
      if (existing.rows[0]?.request_sha256 === requestSha256) {
        return { accepted: true as const, commandId: existing.rows[0].id, jobId };
      }
    }
    assertLease(row, context, input.workerId, input.fencingToken);
    if (row.job_status !== "WAITING" || row.instance_status !== "WAITING" || row.revision !== row.checkpoint_revision || row.pending_command_id) {
      throw new RuntimeStateConflictError("This job is no longer the active process wait.");
    }
    const output: JsonObject = {};
    for (const [variableKey, resultKey] of Object.entries(row.output_mapping)) {
      if (Object.hasOwn(rawResult, resultKey)) output[variableKey] = rawResult[resultKey];
    }
    const commandId = randomUUID();
    await client.query(
      `INSERT INTO runtime_commands
        (id, organization_id, instance_id, type, status, expected_revision,
         target_job_id, payload, idempotency_key, request_sha256, created_by)
       VALUES ($1, $2, $3, 'JOB_COMPLETE', 'ACCEPTED', $4, $5, $6::jsonb, $7, $8, $9)`,
      [commandId, context.organizationId, row.instance_id, row.revision, jobId,
        JSON.stringify({ output, submission: rawResult }), idempotencyKey, requestSha256, context.createdBy],
    );
    await client.query(
      `UPDATE process_instances SET pending_command_id = $1, updated_at = now() WHERE id = $2`,
      [commandId, row.instance_id],
    );
    await client.query(
      `UPDATE process_jobs SET completed_by_credential_id = $1 WHERE id = $2`,
      [context.credentialId, jobId],
    );
    await client.query(
      `UPDATE external_job_deliveries SET status = 'SUCCEEDED', result = $1::jsonb,
         finished_at = now(), lock_expires_at = NULL, worker_id = NULL, credential_id = NULL,
         updated_at = now() WHERE id = $2`,
      [JSON.stringify(rawResult), input.deliveryId],
    );
    await client.query(
      `INSERT INTO durable_work (id, organization_id, instance_id, command_id, kind, status)
       VALUES ($1, $2, $3, $4, 'ADVANCE_INSTANCE', 'AVAILABLE')`,
      [randomUUID(), context.organizationId, row.instance_id, commandId],
    );
    await client.query(
      `INSERT INTO outbox_events (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'external_job.completion_accepted', 'external_job', $2, $3::jsonb)`,
      [context.organizationId, jobId, JSON.stringify({ jobId, deliveryId: input.deliveryId, commandId, credentialId: context.credentialId })],
    );
    return { accepted: true as const, commandId, jobId };
  });
}

export async function failExternalJob(
  context: JobWorkerContext,
  jobId: string,
  input: { deliveryId: string; workerId: string; fencingToken: number; code: string; message: string },
) {
  const code = input.code.trim().slice(0, 120);
  const message = input.message.trim().slice(0, 4000);
  if (!code || !message) throw new RuntimePolicyError("INVALID_JOB_FAILURE", "Failure code and message are required.");
  return withTransaction(async (client) => {
    const row = await lockedDelivery(client, context, jobId, input.deliveryId);
    assertLease(row, context, input.workerId, input.fencingToken);
    if (row.job_status !== "WAITING" || row.instance_status !== "WAITING" || row.pending_command_id) {
      throw new RuntimeStateConflictError("This job is no longer the active process wait.");
    }
    await client.query(
      `UPDATE external_job_deliveries SET status = 'FAILED', failure_code = $1,
         failure_message = $2, finished_at = now(), lock_expires_at = NULL,
         worker_id = NULL, credential_id = NULL, updated_at = now() WHERE id = $3`,
      [code, message, input.deliveryId],
    );
    if (row.cycle_attempt < row.max_attempts) {
      const delaySeconds = Math.min(86400, row.retry_backoff_seconds * (2 ** (row.cycle_attempt - 1)));
      await client.query(
        `INSERT INTO external_job_deliveries
          (organization_id, job_id, attempt, retry_cycle, cycle_attempt, status, available_at)
         VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', now() + ($6 * interval '1 second'))`,
        [context.organizationId, jobId, row.attempt + 1, row.retry_cycle, row.cycle_attempt + 1, delaySeconds],
      );
      await client.query(
        `INSERT INTO outbox_events (organization_id, type, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'external_job.retry_scheduled', 'external_job', $2, $3::jsonb)`,
        [context.organizationId, jobId, JSON.stringify({ jobId, failedDeliveryId: input.deliveryId, nextAttempt: row.attempt + 1, delaySeconds, credentialId: context.credentialId })],
      );
      return { status: "RETRY_SCHEDULED" as const, nextAttempt: row.attempt + 1, delaySeconds };
    }
    const incidentId = randomUUID();
    await client.query(
      `UPDATE process_instances SET status = 'INCIDENT', updated_at = now()
       WHERE id = $1 AND pending_command_id IS NULL`,
      [row.instance_id],
    );
    await client.query(
      `INSERT INTO runtime_incidents
        (id, organization_id, instance_id, command_id, job_id, delivery_id, code, message)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
      [incidentId, context.organizationId, row.instance_id, jobId, input.deliveryId, code, message],
    );
    const scope = await client.query<{ workspace_id: string }>(
      `SELECT project.workspace_id
       FROM process_instances instance
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE instance.id = $1 AND instance.organization_id = $2`,
      [row.instance_id, context.organizationId],
    );
    if (scope.rows[0]) {
      await notifyWorkspaceRoles(client, {
        organizationId: context.organizationId,
        workspaceId: scope.rows[0].workspace_id,
        roles: ["organization-owner", "workspace-admin", "operator"],
        actorId: context.createdBy,
        kind: "INCIDENT_OPENED",
        title: "Process needs attention",
        body: message,
        href: `/operations/${row.instance_id}`,
        resourceType: "runtime-incident",
        resourceId: incidentId,
        dedupeKey: `incident:${incidentId}:opened`,
      });
    }
    await client.query(
      `INSERT INTO outbox_events (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'external_job.retries_exhausted', 'external_job', $2, $3::jsonb)`,
      [context.organizationId, jobId, JSON.stringify({ jobId, deliveryId: input.deliveryId, incidentId, code, credentialId: context.credentialId })],
    );
    return { status: "INCIDENT" as const, incidentId };
  });
}

export async function retryExternalJob(context: PrincipalContext, jobId: string) {
  assertPermission(context, "job:retry");
  return withTransaction(async (client) => {
    const result = await client.query<{
      instance_id: string;
      job_status: ExternalJob["status"];
      instance_status: string;
      pending_command_id: string | null;
      max_attempt: number;
      max_cycle: number;
      incident_id: string | null;
    }>(
      `SELECT job.instance_id, job.status AS job_status, instance.status AS instance_status,
         instance.pending_command_id,
         (SELECT coalesce(max(delivery.attempt), 0)::integer
          FROM external_job_deliveries delivery WHERE delivery.job_id = job.id) AS max_attempt,
         (SELECT coalesce(max(delivery.retry_cycle), 0)::integer
          FROM external_job_deliveries delivery WHERE delivery.job_id = job.id) AS max_cycle,
         (SELECT incident.id FROM runtime_incidents incident
          WHERE incident.job_id = job.id AND incident.status = 'OPEN'
          ORDER BY incident.created_at DESC LIMIT 1) AS incident_id
       FROM process_jobs job
       JOIN process_instances instance
         ON instance.id = job.instance_id AND instance.organization_id = job.organization_id
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE job.id = $1 AND job.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF job, instance`,
      [jobId, context.organization.id, context.workspaceScopeId],
    );
    const row = result.rows[0];
    if (!row) throw new ResourceNotFoundError("external job");
    if (row.job_status !== "WAITING" || row.instance_status !== "INCIDENT" || row.pending_command_id || !row.incident_id) {
      throw new RuntimeStateConflictError("Only an exhausted external job with an open incident can be retried.");
    }
    const incidentOwner = await client.query<{ owner_id: string | null }>(
      "SELECT owner_id FROM runtime_incidents WHERE id = $1 AND organization_id = $2",
      [row.incident_id, context.organization.id],
    );
    await client.query(
      `UPDATE runtime_incidents SET status = 'RESOLVED', resolved_at = now()
       WHERE id = $1 AND status = 'OPEN'`,
      [row.incident_id],
    );
    await client.query(
      `INSERT INTO runtime_incident_notes
        (organization_id, incident_id, author_id, action, body)
       VALUES ($1, $2, $3, 'RETRY_STARTED', 'A fresh external-job retry cycle was started.'),
              ($1, $2, $3, 'RESOLVED', 'The process returned to its durable wait.')`,
      [context.organization.id, row.incident_id, context.principal.id],
    );
    await client.query(
      `UPDATE process_instances SET status = 'WAITING', updated_at = now() WHERE id = $1`,
      [row.instance_id],
    );
    await client.query(
      `INSERT INTO external_job_deliveries
        (organization_id, job_id, attempt, retry_cycle, cycle_attempt, status)
       VALUES ($1, $2, $3, $4, 1, 'AVAILABLE')`,
      [context.organization.id, jobId, row.max_attempt + 1, row.max_cycle + 1],
    );
    await client.query(
      `INSERT INTO outbox_events (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'external_job.operator_retry', 'external_job', $2, $3::jsonb)`,
      [context.organization.id, jobId, JSON.stringify({ jobId, incidentId: row.incident_id, attempt: row.max_attempt + 1 })],
    );
    await insertAudit(client, context.organization.id, context.principal.id,
      "external_job.operator_retry", jobId, { incidentId: row.incident_id, attempt: row.max_attempt + 1, retryCycle: row.max_cycle + 1 });
    if (incidentOwner.rows[0]?.owner_id) {
      await insertNotification(client, {
        organizationId: context.organization.id,
        recipientId: incidentOwner.rows[0].owner_id,
        actorId: context.principal.id,
        kind: "INCIDENT_RESOLVED",
        title: "Incident moved to retry",
        body: "A fresh delivery cycle is now available.",
        href: `/operations/${row.instance_id}`,
        resourceType: "runtime-incident",
        resourceId: row.incident_id,
        dedupeKey: `incident:${row.incident_id}:resolved`,
      });
    }
    return { jobId, status: "WAITING" as const, attempt: row.max_attempt + 1, retryCycle: row.max_cycle + 1 };
  });
}

async function insertAudit(
  client: PoolClient,
  organizationId: string,
  actorId: string,
  action: string,
  resourceId: string,
  details: JsonObject,
) {
  await client.query(
    `INSERT INTO audit_records
      (organization_id, actor_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, 'runtime', $4, $5::jsonb)`,
    [organizationId, actorId, action, resourceId, JSON.stringify(details)],
  );
}
