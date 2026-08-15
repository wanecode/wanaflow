import { createHash, randomUUID } from "node:crypto";

import { assertPermission } from "./authorization";
import { ResourceNotFoundError, RuntimePolicyError, RuntimeStateConflictError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type {
  MessageCorrelationResult,
  MessageSubscription,
  PrincipalContext,
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

function requestHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function payloadObject(input: unknown): JsonObject {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimePolicyError("INVALID_MESSAGE_PAYLOAD", "Message payload must be a JSON object.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new RuntimePolicyError("INVALID_MESSAGE_PAYLOAD", "Message payload must be JSON serializable.");
  }
  if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
    throw new RuntimePolicyError("MESSAGE_PAYLOAD_TOO_LARGE", "Message payload exceeds the 1 MiB limit.");
  }
  return JSON.parse(serialized) as JsonObject;
}

type SubscriptionRow = {
  id: string;
  instance_id: string;
  process_name: string;
  business_key: string | null;
  environment_id: string;
  environment_key: string;
  environment_name: string;
  checkpoint_revision: number;
  element_id: string;
  element_name: string;
  message_name: string;
  correlation_key: string;
  status: "WAITING" | "CONSUMED" | "CANCELLED";
  completion_pending: boolean;
  payload: JsonObject | null;
  created_at: Date;
  consumed_at: Date | null;
};

const SUBSCRIPTION_SELECT = `
  SELECT subscription.id, subscription.instance_id, instance.process_name,
    instance.business_key, instance.environment_id, environment.key AS environment_key,
    environment.name AS environment_name, subscription.checkpoint_revision,
    subscription.element_id, subscription.element_name, subscription.message_name,
    subscription.correlation_key,
    CASE WHEN instance.status = 'CANCELLED' AND subscription.status = 'WAITING'
      THEN 'CANCELLED' ELSE subscription.status END AS status,
    EXISTS (
      SELECT 1 FROM runtime_commands pending
      WHERE pending.id = instance.pending_command_id
        AND pending.target_subscription_id = subscription.id
        AND pending.status IN ('ACCEPTED', 'CLAIMED')
    ) AS completion_pending,
    subscription.payload, subscription.created_at, subscription.consumed_at
  FROM message_subscriptions subscription
  JOIN process_instances instance
    ON instance.id = subscription.instance_id
    AND instance.organization_id = subscription.organization_id
  JOIN environments environment
    ON environment.id = instance.environment_id
    AND environment.organization_id = instance.organization_id
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

function mapSubscription(row: SubscriptionRow): MessageSubscription {
  return {
    id: row.id,
    instanceId: row.instance_id,
    processName: row.process_name,
    businessKey: row.business_key,
    environment: { id: row.environment_id, key: row.environment_key, name: row.environment_name },
    checkpointRevision: row.checkpoint_revision,
    elementId: row.element_id,
    elementName: row.element_name,
    messageName: row.message_name,
    correlationKey: row.correlation_key,
    status: row.status,
    completionPending: row.completion_pending,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    consumedAt: row.consumed_at?.toISOString() ?? null,
  };
}

export async function listMessageSubscriptions(
  context: PrincipalContext,
  filter: { instanceId?: string; status?: MessageSubscription["status"] } = {},
): Promise<MessageSubscription[]> {
  assertPermission(context, "message:read");
  const result = await getPool().query<SubscriptionRow>(
    `${SUBSCRIPTION_SELECT}
     WHERE subscription.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND ($3::uuid IS NULL OR subscription.instance_id = $3)
       AND ($4::text IS NULL OR
         CASE WHEN instance.status = 'CANCELLED' AND subscription.status = 'WAITING'
           THEN 'CANCELLED' ELSE subscription.status END = $4)
     ORDER BY subscription.created_at DESC, subscription.id DESC`,
    [context.organization.id, context.workspaceScopeId, filter.instanceId ?? null, filter.status ?? null],
  );
  return result.rows.map(mapSubscription);
}

export async function getMessageSubscription(
  context: PrincipalContext,
  subscriptionId: string,
): Promise<MessageSubscription> {
  assertPermission(context, "message:read");
  const result = await getPool().query<SubscriptionRow>(
    `${SUBSCRIPTION_SELECT}
     WHERE subscription.id = $1 AND subscription.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [subscriptionId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("message subscription");
  return mapSubscription(result.rows[0]);
}

type AttemptResult = {
  outcome: MessageCorrelationResult["outcome"];
  attemptId: string;
  commandId: string | null;
  subscriptionId: string | null;
};

async function publicAttemptResult(
  context: PrincipalContext,
  result: AttemptResult,
): Promise<MessageCorrelationResult> {
  return {
    outcome: result.outcome,
    attemptId: result.attemptId,
    commandId: result.commandId,
    subscription: result.subscriptionId
      ? await getMessageSubscription(context, result.subscriptionId)
      : null,
  };
}

export async function correlateMessage(
  context: PrincipalContext,
  input: {
    environmentId: string;
    messageName: string;
    correlationKey: string;
    payload?: unknown;
    idempotencyKey: string;
  },
): Promise<MessageCorrelationResult> {
  assertPermission(context, "message:correlate");
  const environmentId = input.environmentId.trim();
  const messageName = input.messageName.trim();
  const correlationKey = input.correlationKey.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const payload = payloadObject(input.payload);
  if (!environmentId) throw new RuntimePolicyError("ENVIRONMENT_REQUIRED", "environmentId is required.");
  if (!/^[a-z][a-z0-9.-]{1,119}$/.test(messageName)) {
    throw new RuntimePolicyError("INVALID_MESSAGE_NAME", "messageName must be a stable lowercase contract name.");
  }
  if (!correlationKey || correlationKey.length > 255) {
    throw new RuntimePolicyError("INVALID_CORRELATION_KEY", "correlationKey must contain 1 to 255 characters.");
  }
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new RuntimePolicyError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 1 to 255 characters.");
  }
  const hash = requestHash({ environmentId, messageName, correlationKey, payload });

  const execute = () => withTransaction(async (client): Promise<AttemptResult> => {
    const existing = await client.query<{
      id: string;
      request_sha256: string;
      outcome: MessageCorrelationResult["outcome"];
      command_id: string | null;
      subscription_id: string | null;
    }>(
      `SELECT id, request_sha256, outcome, command_id, subscription_id
       FROM message_correlation_attempts
       WHERE organization_id = $1 AND idempotency_key = $2`,
      [context.organization.id, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_sha256 !== hash) {
        throw new RuntimeStateConflictError("This idempotency key was already used for a different message correlation.");
      }
      return {
        outcome: existing.rows[0].outcome,
        attemptId: existing.rows[0].id,
        commandId: existing.rows[0].command_id,
        subscriptionId: existing.rows[0].subscription_id,
      };
    }

    const environment = await client.query(
      `SELECT 1 FROM environments environment
       JOIN projects project
         ON project.id = environment.project_id AND project.organization_id = environment.organization_id
       WHERE environment.id = $1 AND environment.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
      [environmentId, context.organization.id, context.workspaceScopeId],
    );
    if (!environment.rows[0]) throw new ResourceNotFoundError("environment");

    const matches = await client.query<{
      id: string;
      instance_id: string;
      revision: number;
      pending_command_id: string | null;
    }>(
      `SELECT subscription.id, subscription.instance_id, instance.revision,
         instance.pending_command_id
       FROM message_subscriptions subscription
       JOIN process_instances instance
         ON instance.id = subscription.instance_id
         AND instance.organization_id = subscription.organization_id
       JOIN projects project
         ON project.id = instance.project_id AND project.organization_id = instance.organization_id
       WHERE subscription.organization_id = $1
         AND instance.environment_id = $2
         AND subscription.message_name = $3
         AND subscription.correlation_key = $4
         AND subscription.status = 'WAITING'
         AND subscription.checkpoint_revision = instance.revision
         AND instance.status = 'WAITING'
         AND ($5::uuid IS NULL OR project.workspace_id = $5)
       ORDER BY subscription.id
       FOR UPDATE OF subscription, instance`,
      [context.organization.id, environmentId, messageName, correlationKey, context.workspaceScopeId],
    );
    const attemptId = randomUUID();
    const outcome: MessageCorrelationResult["outcome"] = matches.rows.length === 0
      ? "NO_MATCH"
      : matches.rows.length === 1
        ? "CORRELATED"
        : "AMBIGUOUS";
    let commandId: string | null = null;
    let subscriptionId: string | null = null;
    if (outcome === "CORRELATED") {
      const match = matches.rows[0];
      if (match.pending_command_id) {
        throw new RuntimeStateConflictError(
          "The matching process already has an accepted command awaiting incorporation.",
        );
      }
      commandId = randomUUID();
      subscriptionId = match.id;
      await client.query(
        `INSERT INTO runtime_commands
          (id, organization_id, instance_id, type, status, expected_revision,
           target_subscription_id, payload, request_sha256, created_by)
         VALUES ($1, $2, $3, 'MESSAGE_CORRELATE', 'ACCEPTED', $4, $5,
           $6::jsonb, $7, $8)`,
        [commandId, context.organization.id, match.instance_id, match.revision, match.id,
          JSON.stringify({ output: payload, submission: payload }), hash, context.principal.id],
      );
      await client.query(
        `UPDATE process_instances SET pending_command_id = $1, updated_at = now()
         WHERE id = $2`,
        [commandId, match.instance_id],
      );
      await client.query(
        `INSERT INTO durable_work
          (id, organization_id, instance_id, command_id, kind, status)
         VALUES ($1, $2, $3, $4, 'ADVANCE_INSTANCE', 'AVAILABLE')`,
        [randomUUID(), context.organization.id, match.instance_id, commandId],
      );
    }
    await client.query(
      `INSERT INTO message_correlation_attempts
        (id, organization_id, environment_id, message_name, correlation_key,
         payload, idempotency_key, request_sha256, outcome, subscription_id,
         command_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
      [attemptId, context.organization.id, environmentId, messageName, correlationKey,
        JSON.stringify(payload), idempotencyKey, hash, outcome, subscriptionId,
        commandId, context.principal.id],
    );
    await client.query(
      `INSERT INTO audit_records
        (organization_id, actor_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'message.correlation_attempted', 'runtime', $3, $4::jsonb)`,
      [context.organization.id, context.principal.id, attemptId, JSON.stringify({
        environmentId, messageName, correlationKey, outcome, subscriptionId, commandId,
      })],
    );
    await client.query(
      `INSERT INTO outbox_events
        (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'message.correlation_attempted', 'message_correlation_attempt', $2, $3::jsonb)`,
      [context.organization.id, attemptId, JSON.stringify({
        attemptId, environmentId, messageName, correlationKey, outcome, subscriptionId, commandId,
      })],
    );
    return { outcome, attemptId, commandId, subscriptionId };
  });

  try {
    return publicAttemptResult(context, await execute());
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const existing = await getPool().query<{
        id: string;
        request_sha256: string;
        outcome: MessageCorrelationResult["outcome"];
        command_id: string | null;
        subscription_id: string | null;
      }>(
        `SELECT id, request_sha256, outcome, command_id, subscription_id
         FROM message_correlation_attempts
         WHERE organization_id = $1 AND idempotency_key = $2`,
        [context.organization.id, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_sha256 !== hash) {
          throw new RuntimeStateConflictError("This idempotency key was already used for a different message correlation.");
        }
        return publicAttemptResult(context, {
          outcome: existing.rows[0].outcome,
          attemptId: existing.rows[0].id,
          commandId: existing.rows[0].command_id,
          subscriptionId: existing.rows[0].subscription_id,
        });
      }
    }
    throw error;
  }
}
