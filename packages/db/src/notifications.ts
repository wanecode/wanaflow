import type { PoolClient } from "pg";

import { assertPermission } from "./authorization";
import { ResourceNotFoundError } from "./errors";
import { getPool } from "./pool";
import type {
  NotificationKind,
  PrincipalContext,
  WanaflowNotification,
} from "./types";

export async function insertNotification(
  client: PoolClient,
  input: {
    organizationId: string;
    recipientId: string;
    actorId?: string | null;
    kind: NotificationKind;
    title: string;
    body: string;
    href: string;
    resourceType: string;
    resourceId: string;
    dedupeKey?: string | null;
  },
) {
  if (input.recipientId === input.actorId) return;
  await client.query(
    `INSERT INTO notifications
      (organization_id, recipient_id, actor_id, kind, title, body, href,
       resource_type, resource_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (organization_id, recipient_id, dedupe_key)
       WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      input.organizationId,
      input.recipientId,
      input.actorId ?? null,
      input.kind,
      input.title,
      input.body,
      input.href,
      input.resourceType,
      input.resourceId,
      input.dedupeKey ?? null,
    ],
  );
}

export async function notifyWorkspaceRoles(
  client: PoolClient,
  input: Omit<Parameters<typeof insertNotification>[1], "recipientId"> & {
    workspaceId: string;
    roles: string[];
  },
) {
  const recipients = await client.query<{ principal_id: string }>(
    `SELECT DISTINCT membership.principal_id
     FROM organization_memberships membership
     WHERE membership.organization_id = $1
       AND membership.role = ANY($2::text[])
       AND (membership.workspace_id IS NULL OR membership.workspace_id = $3)`,
    [input.organizationId, input.roles, input.workspaceId],
  );
  for (const recipient of recipients.rows) {
    await insertNotification(client, { ...input, recipientId: recipient.principal_id });
  }
}

export async function listNotifications(
  context: PrincipalContext,
  input: { unreadOnly?: boolean; limit?: number } = {},
): Promise<WanaflowNotification[]> {
  assertPermission(context, "notification:read");
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const result = await getPool().query<{
    id: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href: string;
    resource_type: string;
    resource_id: string;
    read_at: Date | null;
    created_at: Date;
    actor_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
  }>(
    `SELECT notification.id, notification.kind, notification.title,
       notification.body, notification.href, notification.resource_type,
       notification.resource_id, notification.read_at, notification.created_at,
       actor.id AS actor_id, actor.display_name AS actor_name, actor.email AS actor_email
     FROM notifications notification
     LEFT JOIN principals actor
       ON actor.id = notification.actor_id
      AND actor.organization_id = notification.organization_id
     WHERE notification.organization_id = $1 AND notification.recipient_id = $2
       AND ($3::boolean = false OR notification.read_at IS NULL)
     ORDER BY notification.created_at DESC, notification.id DESC
     LIMIT $4`,
    [context.organization.id, context.principal.id, Boolean(input.unreadOnly), limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    actor: row.actor_id && row.actor_name && row.actor_email
      ? { id: row.actor_id, displayName: row.actor_name, email: row.actor_email }
      : null,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function markNotificationRead(
  context: PrincipalContext,
  notificationId: string,
) {
  assertPermission(context, "notification:read");
  const result = await getPool().query(
    `UPDATE notifications SET read_at = coalesce(read_at, now())
     WHERE id = $1 AND organization_id = $2 AND recipient_id = $3`,
    [notificationId, context.organization.id, context.principal.id],
  );
  if (!result.rowCount) throw new ResourceNotFoundError("notification");
}

export async function markAllNotificationsRead(context: PrincipalContext) {
  assertPermission(context, "notification:read");
  const result = await getPool().query(
    `UPDATE notifications SET read_at = now()
     WHERE organization_id = $1 AND recipient_id = $2 AND read_at IS NULL`,
    [context.organization.id, context.principal.id],
  );
  return result.rowCount ?? 0;
}
