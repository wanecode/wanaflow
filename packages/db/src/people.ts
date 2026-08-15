import { createHash, randomBytes } from "node:crypto";

import { assertPermission, assertProjectAccess, assertWorkspaceAccess } from "./authorization";
import {
  DuplicateResourceError,
  PermissionDeniedError,
  ResourceNotFoundError,
  RuntimeStateConflictError,
} from "./errors";
import { insertNotification } from "./notifications";
import { getPool, withTransaction } from "./pool";
import type {
  InvitationPreview,
  MembershipRole,
  OrganizationInvitation,
  PrincipalContext,
  WorkGroup,
  TaskOwnerOptions,
  WorkspaceMember,
} from "./types";

const invitationalRoles = new Set<Exclude<MembershipRole, "organization-owner">>([
  "workspace-admin",
  "designer",
  "reviewer",
  "operator",
  "task-worker",
]);

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mapInvitation(row: {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string;
  role: Exclude<MembershipRole, "organization-owner">;
  inviter_id: string;
  inviter_name: string;
  inviter_email: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}): OrganizationInvitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    invitedBy: { id: row.inviter_id, displayName: row.inviter_name, email: row.inviter_email },
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listWorkspaceMembers(
  context: PrincipalContext,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  assertPermission(context, "membership:manage");
  await assertWorkspaceAccess(context, workspaceId);
  const result = await getPool().query<{
    id: string;
    display_name: string;
    email: string;
    workspace_id: string | null;
    role: MembershipRole;
    created_at: Date;
  }>(
    `SELECT DISTINCT ON (principal.id) principal.id, principal.display_name,
       principal.email, membership.workspace_id, membership.role, membership.created_at
     FROM organization_memberships membership
     JOIN principals principal
       ON principal.id = membership.principal_id
      AND principal.organization_id = membership.organization_id
     WHERE membership.organization_id = $1
       AND (membership.workspace_id IS NULL OR membership.workspace_id = $2)
     ORDER BY principal.id, membership.workspace_id NULLS LAST`,
    [context.organization.id, workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    workspaceId: row.workspace_id,
    role: row.role,
    joinedAt: row.created_at.toISOString(),
  }));
}

export async function listInvitations(
  context: PrincipalContext,
  workspaceId: string,
): Promise<OrganizationInvitation[]> {
  assertPermission(context, "membership:manage");
  await assertWorkspaceAccess(context, workspaceId);
  const result = await getPool().query<Parameters<typeof mapInvitation>[0]>(
    `SELECT invitation.id, invitation.workspace_id, invitation.email,
       invitation.display_name, invitation.role, invitation.expires_at,
       invitation.accepted_at, invitation.revoked_at, invitation.created_at,
       inviter.id AS inviter_id, inviter.display_name AS inviter_name,
       inviter.email AS inviter_email
     FROM organization_invitations invitation
     JOIN principals inviter
       ON inviter.id = invitation.invited_by
      AND inviter.organization_id = invitation.organization_id
     WHERE invitation.organization_id = $1 AND invitation.workspace_id = $2
     ORDER BY invitation.created_at DESC`,
    [context.organization.id, workspaceId],
  );
  return result.rows.map(mapInvitation);
}

export async function createInvitation(
  context: PrincipalContext,
  input: {
    workspaceId: string;
    email: string;
    displayName: string;
    role: Exclude<MembershipRole, "organization-owner">;
  },
) {
  assertPermission(context, "membership:manage");
  await assertWorkspaceAccess(context, input.workspaceId);
  if (!invitationalRoles.has(input.role)) throw new PermissionDeniedError("membership:manage:role");
  const email = input.email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  try {
    const result = await getPool().query<Parameters<typeof mapInvitation>[0]>(
      `WITH created AS (
         INSERT INTO organization_invitations
           (organization_id, workspace_id, email, display_name, role,
            token_sha256, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')
         RETURNING *
       )
       SELECT created.id, created.workspace_id, created.email, created.display_name,
         created.role, created.expires_at, created.accepted_at, created.revoked_at,
         created.created_at, inviter.id AS inviter_id,
         inviter.display_name AS inviter_name, inviter.email AS inviter_email
       FROM created
       JOIN principals inviter ON inviter.id = created.invited_by
        AND inviter.organization_id = created.organization_id`,
      [
        context.organization.id,
        input.workspaceId,
        email,
        input.displayName.trim(),
        input.role,
        tokenHash(token),
        context.principal.id,
      ],
    );
    return { ...mapInvitation(result.rows[0]), acceptUrl: `/join/${token}` };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new DuplicateResourceError("email");
    }
    throw error;
  }
}

export async function revokeInvitation(context: PrincipalContext, invitationId: string) {
  assertPermission(context, "membership:manage");
  const result = await getPool().query(
    `UPDATE organization_invitations invitation SET revoked_at = now()
     WHERE invitation.id = $1 AND invitation.organization_id = $2
       AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
       AND ($3::uuid IS NULL OR invitation.workspace_id = $3)`,
    [invitationId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rowCount) throw new ResourceNotFoundError("invitation");
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const result = await getPool().query<{
    organization_id: string;
    organization_name: string;
    workspace_id: string;
    workspace_name: string;
    email: string;
    display_name: string;
    role: Exclude<MembershipRole, "organization-owner">;
    expires_at: Date;
    existing_account: boolean;
  }>(
    `SELECT organization.id AS organization_id, organization.name AS organization_name,
       workspace.id AS workspace_id, workspace.name AS workspace_name,
       invitation.email, invitation.display_name, invitation.role,
       invitation.expires_at, existing.id IS NOT NULL AS existing_account
     FROM organization_invitations invitation
     JOIN organizations organization ON organization.id = invitation.organization_id
     JOIN workspaces workspace ON workspace.id = invitation.workspace_id
      AND workspace.organization_id = invitation.organization_id
     LEFT JOIN "user" existing ON lower(existing.email) = lower(invitation.email)
     WHERE invitation.token_sha256 = $1 AND invitation.accepted_at IS NULL
       AND invitation.revoked_at IS NULL AND invitation.expires_at > now()`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (!row) throw new ResourceNotFoundError("invitation");
  return {
    organization: { id: row.organization_id, name: row.organization_name },
    workspace: { id: row.workspace_id, name: row.workspace_name },
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    expiresAt: row.expires_at.toISOString(),
    existingAccount: row.existing_account,
  };
}

export async function acceptInvitation(token: string, authUserId: string) {
  return withTransaction(async (client) => {
    const locked = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      email: string;
      display_name: string;
      role: MembershipRole;
      invited_by: string;
    }>(
      `SELECT id, organization_id, workspace_id, email, display_name, role, invited_by
       FROM organization_invitations
       WHERE token_sha256 = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [tokenHash(token)],
    );
    const invitation = locked.rows[0];
    if (!invitation) throw new ResourceNotFoundError("invitation");
    const account = await client.query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = $1`,
      [authUserId],
    );
    if (account.rows[0]?.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new RuntimeStateConflictError("This invitation belongs to a different email address.");
    }
    const principal = await client.query<{ id: string }>(
      `INSERT INTO principals (organization_id, auth_user_id, email, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, auth_user_id) WHERE auth_user_id IS NOT NULL
       DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
       RETURNING id`,
      [invitation.organization_id, authUserId, invitation.email, invitation.display_name],
    );
    await client.query(
      `INSERT INTO organization_memberships
        (organization_id, principal_id, workspace_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, workspace_id, principal_id)
         WHERE workspace_id IS NOT NULL DO NOTHING`,
      [invitation.organization_id, principal.rows[0].id, invitation.workspace_id, invitation.role],
    );
    await client.query(
      `UPDATE organization_invitations SET accepted_at = now() WHERE id = $1`,
      [invitation.id],
    );
    await insertNotification(client, {
      organizationId: invitation.organization_id,
      recipientId: invitation.invited_by,
      actorId: principal.rows[0].id,
      kind: "INVITATION_ACCEPTED",
      title: `${invitation.display_name} joined the workspace`,
      body: `${invitation.email} accepted the invitation as ${invitation.role.replaceAll("-", " ")}.`,
      href: "/people",
      resourceType: "invitation",
      resourceId: invitation.id,
      dedupeKey: `invitation:${invitation.id}:accepted`,
    });
    return { principalId: principal.rows[0].id, organizationId: invitation.organization_id };
  });
}

async function loadGroups(organizationId: string, workspaceId: string): Promise<WorkGroup[]> {
  const result = await getPool().query<{
    id: string;
    workspace_id: string;
    key: string;
    name: string;
    created_at: Date;
    members: Array<{ id: string; displayName: string; email: string }> | null;
  }>(
    `SELECT work_group.id, work_group.workspace_id, work_group.key,
       work_group.name, work_group.created_at,
       coalesce(jsonb_agg(jsonb_build_object(
         'id', principal.id, 'displayName', principal.display_name, 'email', principal.email
       ) ORDER BY principal.display_name) FILTER (WHERE principal.id IS NOT NULL), '[]'::jsonb) AS members
     FROM work_groups work_group
     LEFT JOIN work_group_members membership ON membership.group_id = work_group.id
     LEFT JOIN principals principal ON principal.id = membership.principal_id
      AND principal.organization_id = membership.organization_id
     WHERE work_group.organization_id = $1 AND work_group.workspace_id = $2
     GROUP BY work_group.id
     ORDER BY work_group.name`,
    [organizationId, workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.key,
    name: row.name,
    members: row.members ?? [],
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listWorkGroups(context: PrincipalContext, workspaceId: string) {
  await assertWorkspaceAccess(context, workspaceId);
  return loadGroups(context.organization.id, workspaceId);
}

export async function createWorkGroup(
  context: PrincipalContext,
  input: { workspaceId: string; key: string; name: string; memberIds: string[] },
) {
  assertPermission(context, "membership:manage");
  await assertWorkspaceAccess(context, input.workspaceId);
  try {
    const groupId = await withTransaction(async (client) => {
      const group = await client.query<{ id: string }>(
        `INSERT INTO work_groups
          (organization_id, workspace_id, key, name, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [context.organization.id, input.workspaceId, input.key, input.name.trim(), context.principal.id],
      );
      for (const principalId of [...new Set(input.memberIds)]) {
        const eligible = await client.query(
          `SELECT 1 FROM organization_memberships
           WHERE organization_id = $1 AND principal_id = $2
             AND (workspace_id IS NULL OR workspace_id = $3)`,
          [context.organization.id, principalId, input.workspaceId],
        );
        if (!eligible.rowCount) throw new ResourceNotFoundError("group member");
        await client.query(
          `INSERT INTO work_group_members
            (group_id, organization_id, principal_id, added_by)
           VALUES ($1, $2, $3, $4)`,
          [group.rows[0].id, context.organization.id, principalId, context.principal.id],
        );
      }
      return group.rows[0].id;
    });
    return (await loadGroups(context.organization.id, input.workspaceId))
      .find((group) => group.id === groupId)!;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new DuplicateResourceError("key");
    }
    throw error;
  }
}

export async function updateWorkGroup(
  context: PrincipalContext,
  groupId: string,
  input: { name: string; memberIds: string[] },
) {
  assertPermission(context, "membership:manage");
  const workspaceId = await withTransaction(async (client) => {
    const group = await client.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM work_groups
       WHERE id = $1 AND organization_id = $2
         AND ($3::uuid IS NULL OR workspace_id = $3)
       FOR UPDATE`,
      [groupId, context.organization.id, context.workspaceScopeId],
    );
    if (!group.rows[0]) throw new ResourceNotFoundError("work group");
    await client.query(`UPDATE work_groups SET name = $1 WHERE id = $2`, [input.name.trim(), groupId]);
    await client.query(`DELETE FROM work_group_members WHERE group_id = $1`, [groupId]);
    for (const principalId of [...new Set(input.memberIds)]) {
      const eligible = await client.query(
        `SELECT 1 FROM organization_memberships
         WHERE organization_id = $1 AND principal_id = $2
           AND (workspace_id IS NULL OR workspace_id = $3)`,
        [context.organization.id, principalId, group.rows[0].workspace_id],
      );
      if (!eligible.rowCount) throw new ResourceNotFoundError("group member");
      await client.query(
        `INSERT INTO work_group_members
          (group_id, organization_id, principal_id, added_by)
         VALUES ($1, $2, $3, $4)`,
        [groupId, context.organization.id, principalId, context.principal.id],
      );
    }
    return group.rows[0].workspace_id;
  });
  return (await loadGroups(context.organization.id, workspaceId)).find((group) => group.id === groupId)!;
}

export async function listTaskOwnerOptions(
  context: PrincipalContext,
  projectId: string,
): Promise<TaskOwnerOptions> {
  assertPermission(context, "artifact:read");
  await assertProjectAccess(context, projectId);
  const project = await getPool().query<{ workspace_id: string }>(
    `SELECT workspace_id FROM projects WHERE id = $1 AND organization_id = $2`,
    [projectId, context.organization.id],
  );
  if (!project.rows[0]) throw new ResourceNotFoundError("project");
  const people = await getPool().query<{
    id: string;
    display_name: string;
    email: string;
    role: MembershipRole;
  }>(
    `SELECT DISTINCT ON (principal.id) principal.id, principal.display_name,
       principal.email, membership.role
     FROM organization_memberships membership
     JOIN principals principal
       ON principal.id = membership.principal_id
      AND principal.organization_id = membership.organization_id
     WHERE membership.organization_id = $1
       AND (membership.workspace_id IS NULL OR membership.workspace_id = $2)
       AND membership.role IN (
         'organization-owner', 'workspace-admin', 'designer', 'operator', 'task-worker'
       )
     ORDER BY principal.id, membership.workspace_id NULLS LAST`,
    [context.organization.id, project.rows[0].workspace_id],
  );
  return {
    people: people.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
    })),
    groups: await loadGroups(context.organization.id, project.rows[0].workspace_id),
  };
}
