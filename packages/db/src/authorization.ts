import {
  MembershipRequiredError,
  OrganizationContextRequiredError,
  PermissionDeniedError,
  ResourceNotFoundError,
} from "./errors";
import { listOrganizationArtifacts } from "./artifacts";
import { getPool } from "./pool";
import type {
  MembershipRole,
  OrganizationLibrary,
  PrincipalContext,
  WanaflowPermission,
  WorkspaceLibrary,
} from "./types";

const allPermissions: WanaflowPermission[] = [
  "project:read",
  "project:create",
  "artifact:read",
  "artifact:create",
  "artifact:update",
  "review:read",
  "review:create",
  "review:comment",
  "review:decide",
  "review:cancel",
  "publication:read",
  "publication:create",
  "environment:read",
  "environment:create",
  "deployment:read",
  "deployment:create",
  "instance:read",
  "instance:start",
  "instance:cancel",
  "task:read",
  "task:complete",
  "task:assign",
  "membership:manage",
  "notification:read",
  "job:read",
  "job:retry",
  "timer:read",
  "message:read",
  "message:correlate",
  "decision:read",
  "decision:evaluate",
  "worker-credential:read",
  "worker-credential:create",
  "worker-credential:revoke",
];

export const rolePermissions: Record<MembershipRole, WanaflowPermission[]> = {
  "organization-owner": allPermissions,
  "workspace-admin": allPermissions,
  designer: ["project:read", "artifact:read", "artifact:create", "artifact:update", "review:read", "review:create", "review:comment", "review:cancel", "publication:read", "publication:create", "environment:read", "deployment:read", "instance:read", "instance:start", "instance:cancel", "task:read", "task:complete", "task:assign", "notification:read", "timer:read", "message:read", "message:correlate", "decision:read", "decision:evaluate"],
  reviewer: ["project:read", "artifact:read", "review:read", "review:comment", "review:decide", "notification:read"],
  operator: ["project:read", "artifact:read", "review:read", "publication:read", "environment:read", "deployment:read", "deployment:create", "instance:read", "instance:start", "instance:cancel", "task:read", "task:complete", "task:assign", "notification:read", "job:read", "job:retry", "timer:read", "message:read", "message:correlate", "decision:read", "decision:evaluate", "worker-credential:read", "worker-credential:create", "worker-credential:revoke"],
  "task-worker": ["instance:read", "task:read", "task:complete", "task:assign", "notification:read"],
};

type ContextRow = {
  organization_id: string;
  organization_key: string;
  organization_name: string;
  principal_id: string;
  auth_user_id: string;
  email: string;
  display_name: string;
  role: MembershipRole;
  workspace_id: string | null;
};

export async function resolvePrincipalContext(
  authUserId: string,
  requestedOrganizationId?: string | null,
): Promise<PrincipalContext> {
  const result = await getPool().query<ContextRow>(
    `SELECT
       o.id AS organization_id,
       o.key AS organization_key,
       o.name AS organization_name,
       p.id AS principal_id,
       p.auth_user_id,
       p.email,
       p.display_name,
       m.role,
       m.workspace_id
     FROM principals p
     JOIN organizations o ON o.id = p.organization_id
     JOIN organization_memberships m
       ON m.organization_id = p.organization_id AND m.principal_id = p.id
     WHERE p.auth_user_id = $1
     ORDER BY o.created_at ASC, m.workspace_id NULLS FIRST`,
    [authUserId],
  );

  if (!result.rows.length) throw new MembershipRequiredError();
  const organizationIds = [...new Set(result.rows.map((row) => row.organization_id))];
  if (!requestedOrganizationId && organizationIds.length > 1) {
    throw new OrganizationContextRequiredError();
  }

  const organizationId = requestedOrganizationId ?? organizationIds[0];
  const row = result.rows.find((entry) => entry.organization_id === organizationId);
  if (!row) throw new ResourceNotFoundError("organization");

  return {
    organization: {
      id: row.organization_id,
      key: row.organization_key,
      name: row.organization_name,
    },
    principal: {
      id: row.principal_id,
      organizationId: row.organization_id,
      authUserId: row.auth_user_id,
      email: row.email,
      displayName: row.display_name,
    },
    role: row.role,
    workspaceScopeId: row.workspace_id,
    permissions: rolePermissions[row.role],
  };
}

export function assertPermission(context: PrincipalContext, permission: WanaflowPermission) {
  if (!context.permissions.includes(permission)) throw new PermissionDeniedError(permission);
}

export async function assertWorkspaceAccess(context: PrincipalContext, workspaceId: string) {
  const result = await getPool().query(
    `SELECT 1 FROM workspaces
     WHERE id = $1 AND organization_id = $2
       AND ($3::uuid IS NULL OR id = $3)`,
    [workspaceId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rowCount) throw new ResourceNotFoundError("workspace");
}

export async function assertProjectAccess(context: PrincipalContext, projectId: string) {
  const result = await getPool().query(
    `SELECT 1 FROM projects
     WHERE id = $1 AND organization_id = $2
       AND ($3::uuid IS NULL OR workspace_id = $3)`,
    [projectId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rowCount) throw new ResourceNotFoundError("project");
}

export async function getOrganizationLibrary(context: PrincipalContext): Promise<OrganizationLibrary> {
  assertPermission(context, "project:read");
  const [workspaceResult, projectResult, artifacts] = await Promise.all([
    getPool().query<{
      id: string;
      organization_id: string;
      key: string;
      name: string;
    }>(
      `SELECT id, organization_id, key, name
       FROM workspaces
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR id = $2)
       ORDER BY created_at ASC`,
      [context.organization.id, context.workspaceScopeId],
    ),
    getPool().query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      key: string;
      name: string;
    }>(
      `SELECT id, organization_id, workspace_id, key, name
       FROM projects
       WHERE organization_id = $1
         AND ($2::uuid IS NULL OR workspace_id = $2)
       ORDER BY created_at ASC`,
      [context.organization.id, context.workspaceScopeId],
    ),
    listOrganizationArtifacts(context.organization.id),
  ]);

  const workspaces: WorkspaceLibrary[] = workspaceResult.rows.map((workspace) => ({
    id: workspace.id,
    organizationId: workspace.organization_id,
    key: workspace.key,
    name: workspace.name,
    projects: projectResult.rows
      .filter((project) => project.workspace_id === workspace.id)
      .map((project) => ({
        id: project.id,
        organizationId: project.organization_id,
        workspaceId: project.workspace_id,
        key: project.key,
        name: project.name,
        artifacts: artifacts.filter((artifact) => artifact.projectId === project.id),
      })),
  }));

  return { ...context, workspaces };
}
