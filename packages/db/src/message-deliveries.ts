import { assertPermission, rolePermissions } from "./authorization";
import { ResourceNotFoundError } from "./errors";
import { correlateMessage } from "./message-subscriptions";
import { getPool, withTransaction } from "./pool";
import type { MessageDelivery, PrincipalContext } from "./types";

type JsonObject = Record<string, unknown>;

type DeliveryRow = {
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
  payload: JsonObject;
  status: MessageDelivery["status"];
  attempts: number;
  correlation_attempt_id: string | null;
  target_subscription_id: string | null;
  last_error: string | null;
  created_at: Date;
  delivered_at: Date | null;
};

const DELIVERY_SELECT = `
  SELECT delivery.id, delivery.instance_id, instance.process_name,
    instance.business_key, delivery.environment_id, environment.key AS environment_key,
    environment.name AS environment_name, delivery.checkpoint_revision,
    delivery.element_id, delivery.element_name, delivery.message_name,
    delivery.correlation_key, delivery.payload, delivery.status, delivery.attempts,
    delivery.correlation_attempt_id, delivery.target_subscription_id,
    delivery.last_error, delivery.created_at, delivery.delivered_at
  FROM message_deliveries delivery
  JOIN process_instances instance
    ON instance.id = delivery.instance_id
    AND instance.organization_id = delivery.organization_id
  JOIN environments environment
    ON environment.id = delivery.environment_id
    AND environment.organization_id = delivery.organization_id
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

function mapDelivery(row: DeliveryRow): MessageDelivery {
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
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    correlationAttemptId: row.correlation_attempt_id,
    targetSubscriptionId: row.target_subscription_id,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
  };
}

export async function listMessageDeliveries(
  context: PrincipalContext,
  filter: { instanceId?: string; status?: MessageDelivery["status"] } = {},
): Promise<MessageDelivery[]> {
  assertPermission(context, "message:read");
  const result = await getPool().query<DeliveryRow>(
    `${DELIVERY_SELECT}
     WHERE delivery.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND ($3::uuid IS NULL OR delivery.instance_id = $3)
       AND ($4::text IS NULL OR delivery.status = $4)
     ORDER BY delivery.created_at DESC, delivery.id DESC`,
    [context.organization.id, context.workspaceScopeId, filter.instanceId ?? null, filter.status ?? null],
  );
  return result.rows.map(mapDelivery);
}

export async function getMessageDelivery(
  context: PrincipalContext,
  deliveryId: string,
): Promise<MessageDelivery> {
  assertPermission(context, "message:read");
  const result = await getPool().query<DeliveryRow>(
    `${DELIVERY_SELECT}
     WHERE delivery.id = $1 AND delivery.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [deliveryId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("message delivery");
  return mapDelivery(result.rows[0]);
}

export type MessageDeliveryClaim = {
  id: string;
  organizationId: string;
  environmentId: string;
  messageName: string;
  correlationKey: string;
  payload: JsonObject;
  actorId: string;
  fencingToken: number;
  attempts: number;
};

export async function claimNextMessageDelivery(
  workerId: string,
  leaseSeconds = 30,
): Promise<MessageDeliveryClaim | null> {
  if (!workerId.trim()) throw new Error("workerId is required");
  return withTransaction(async (client) => {
    const candidate = await client.query<{ id: string }>(
      `SELECT id FROM message_deliveries
       WHERE available_at <= now()
         AND (status = 'AVAILABLE' OR (status = 'CLAIMED' AND lease_expires_at < now()))
       ORDER BY available_at, created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    if (!candidate.rows[0]) return null;
    const claimed = await client.query<{
      id: string;
      organization_id: string;
      environment_id: string;
      message_name: string;
      correlation_key: string;
      payload: JsonObject;
      created_by: string;
      fencing_token: string;
      attempts: number;
    }>(
      `UPDATE message_deliveries SET status = 'CLAIMED', claim_owner = $1,
         lease_expires_at = now() + make_interval(secs => $2),
         fencing_token = fencing_token + 1, attempts = attempts + 1,
         last_error = NULL, updated_at = now()
       WHERE id = $3
       RETURNING id, organization_id, environment_id, message_name,
         correlation_key, payload, created_by, fencing_token, attempts`,
      [workerId, Math.max(1, Math.min(300, leaseSeconds)), candidate.rows[0].id],
    );
    const row = claimed.rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      environmentId: row.environment_id,
      messageName: row.message_name,
      correlationKey: row.correlation_key,
      payload: row.payload,
      actorId: row.created_by,
      fencingToken: Number(row.fencing_token),
      attempts: row.attempts,
    };
  });
}

async function deliveryContext(claim: MessageDeliveryClaim): Promise<PrincipalContext> {
  const result = await getPool().query<{
    organization_key: string;
    organization_name: string;
    auth_user_id: string | null;
    email: string;
    display_name: string;
  }>(
    `SELECT organization.key AS organization_key, organization.name AS organization_name,
       principal.auth_user_id, principal.email, principal.display_name
     FROM organizations organization
     JOIN principals principal
       ON principal.organization_id = organization.id AND principal.id = $2
     WHERE organization.id = $1`,
    [claim.organizationId, claim.actorId],
  );
  const row = result.rows[0];
  if (!row) throw new ResourceNotFoundError("message delivery actor");
  return {
    organization: { id: claim.organizationId, key: row.organization_key, name: row.organization_name },
    principal: {
      id: claim.actorId,
      organizationId: claim.organizationId,
      ...(row.auth_user_id ? { authUserId: row.auth_user_id } : {}),
      email: row.email,
      displayName: row.display_name,
    },
    role: "organization-owner",
    workspaceScopeId: null,
    permissions: rolePermissions["organization-owner"],
  };
}

async function retryClaim(claim: MessageDeliveryClaim, error: unknown) {
  const retryAt = new Date(Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(5, claim.attempts - 1)));
  const message = (error instanceof Error ? error.message : "Message delivery failed unexpectedly.").slice(0, 4000);
  return getPool().query(
    `UPDATE message_deliveries SET status = 'AVAILABLE', available_at = $1,
       claim_owner = NULL, lease_expires_at = NULL, last_error = $2, updated_at = now()
     WHERE id = $3 AND status = 'CLAIMED' AND fencing_token = $4`,
    [retryAt, message, claim.id, claim.fencingToken],
  );
}

export async function dispatchClaimedMessageDelivery(claim: MessageDeliveryClaim) {
  try {
    const result = await correlateMessage(await deliveryContext(claim), {
      environmentId: claim.environmentId,
      messageName: claim.messageName,
      correlationKey: claim.correlationKey,
      payload: claim.payload,
      idempotencyKey: `message-delivery:${claim.id}`,
    });
    const status = result.outcome === "CORRELATED" ? "DELIVERED" : result.outcome;
    const settled = await getPool().query(
      `UPDATE message_deliveries SET status = $1, correlation_attempt_id = $2,
         target_subscription_id = $3, delivered_at = now(), claim_owner = NULL,
         lease_expires_at = NULL, last_error = NULL, updated_at = now()
       WHERE id = $4 AND status = 'CLAIMED' AND fencing_token = $5`,
      [status, result.attemptId, result.subscription?.id ?? null, claim.id, claim.fencingToken],
    );
    return { handled: true as const, settled: Boolean(settled.rowCount), deliveryId: claim.id, outcome: result.outcome };
  } catch (error) {
    const retried = await retryClaim(claim, error);
    return {
      handled: true as const,
      settled: false,
      retrying: Boolean(retried.rowCount),
      deliveryId: claim.id,
      error: error instanceof Error ? error.message : "Message delivery failed unexpectedly.",
    };
  }
}

export async function dispatchNextMessageDelivery(workerId: string, leaseSeconds = 30) {
  const claim = await claimNextMessageDelivery(workerId, leaseSeconds);
  if (!claim) return { handled: false as const };
  return dispatchClaimedMessageDelivery(claim);
}
