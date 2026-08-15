import { createHash } from "node:crypto";

import {
  validateBpmnXml,
  validateDmnXml,
  validateFormSource,
  type ArtifactValidationResult,
} from "@wanaflow/modeling";
import type { PoolClient } from "pg";

import {
  BootstrapUnavailableError,
  DuplicateResourceError,
  ResourceNotFoundError,
  RevisionConflictError,
} from "./errors";
import { getPool, withTransaction } from "./pool";
import type {
  Artifact,
  ArtifactRevision,
  ArtifactType,
  LocalSetup,
  Principal,
  Project,
} from "./types";

type ArtifactRow = {
  artifact_id: string;
  organization_id: string;
  project_id: string;
  artifact_key: string;
  artifact_name: string;
  artifact_type: ArtifactType;
  artifact_created_at: Date;
  artifact_updated_at: Date;
  revision_id: string;
  revision_number: number;
  source: string;
  content_sha256: string;
  validation: ArtifactValidationResult;
  revision_created_at: Date;
  created_by_id: string;
  created_by_name: string;
};

const ARTIFACT_SELECT = `
  SELECT
    a.id AS artifact_id,
    a.organization_id,
    a.project_id,
    a.key AS artifact_key,
    a.name AS artifact_name,
    a.type AS artifact_type,
    a.created_at AS artifact_created_at,
    a.updated_at AS artifact_updated_at,
    r.id AS revision_id,
    r.number AS revision_number,
    r.source,
    r.content_sha256,
    r.validation,
    r.created_at AS revision_created_at,
    p.id AS created_by_id,
    p.display_name AS created_by_name
  FROM artifacts a
  JOIN artifact_revisions r ON r.id = a.draft_head_revision_id
  JOIN principals p ON p.id = r.created_by
`;

function sha256(source: string) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function mapRevision(row: ArtifactRow): ArtifactRevision {
  return {
    id: row.revision_id,
    artifactId: row.artifact_id,
    number: row.revision_number,
    source: row.source,
    contentSha256: row.content_sha256,
    validation: row.validation,
    createdAt: row.revision_created_at.toISOString(),
    createdBy: { id: row.created_by_id, displayName: row.created_by_name },
  };
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.artifact_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    key: row.artifact_key,
    name: row.artifact_name,
    type: row.artifact_type,
    revision: mapRevision(row),
    createdAt: row.artifact_created_at.toISOString(),
    updatedAt: row.artifact_updated_at.toISOString(),
  };
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isForeignKeyViolation(error: unknown): error is { code: "23503" } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23503";
}

async function insertAuditAndEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO audit_records
      (organization_id, actor_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.organizationId,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.payload),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events
      (organization_id, type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.organizationId,
      input.eventType,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.payload),
    ],
  );
}

async function ensureDefaultEnvironments(
  client: PoolClient,
  organizationId: string,
  projectId: string,
) {
  await client.query(
    `INSERT INTO environments (organization_id, project_id, key, name)
     VALUES
       ($1, $2, 'development', 'Development'),
       ($1, $2, 'staging', 'Staging'),
       ($1, $2, 'production', 'Production')
     ON CONFLICT (organization_id, project_id, key) DO NOTHING`,
    [organizationId, projectId],
  );
}

async function loadArtifactWithClient(client: PoolClient, organizationId: string, artifactId: string) {
  const result = await client.query<ArtifactRow>(
    `${ARTIFACT_SELECT} WHERE a.organization_id = $1 AND a.id = $2`,
    [organizationId, artifactId],
  );
  return result.rows[0] ? mapArtifact(result.rows[0]) : null;
}

async function createArtifactWithClient(
  client: PoolClient,
  input: {
    organizationId: string;
    projectId: string;
    principalId: string;
    key: string;
    name: string;
    type: ArtifactType;
    source: string;
    validation: ArtifactValidationResult;
  },
) {
  const artifactInsert = await client.query<{ id: string }>(
    `INSERT INTO artifacts (organization_id, project_id, key, name, type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.organizationId, input.projectId, input.key, input.name, input.type],
  );
  const artifactId = artifactInsert.rows[0].id;
  const contentSha256 = sha256(input.source);
  const revisionInsert = await client.query<{ id: string }>(
    `INSERT INTO artifact_revisions
      (organization_id, artifact_id, number, source, content_sha256, validation_status, validation, created_by)
     VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [
      input.organizationId,
      artifactId,
      input.source,
      contentSha256,
      input.validation.status,
      JSON.stringify(input.validation),
      input.principalId,
    ],
  );

  await client.query(
    `UPDATE artifacts
     SET draft_head_revision_id = $1, next_revision_number = 2, updated_at = now()
     WHERE id = $2`,
    [revisionInsert.rows[0].id, artifactId],
  );
  await insertAuditAndEvent(client, {
    organizationId: input.organizationId,
    actorId: input.principalId,
    action: "artifact.created",
    resourceType: "artifact",
    resourceId: artifactId,
    eventType: "artifact.created",
    payload: {
      artifactId,
      projectId: input.projectId,
      revisionId: revisionInsert.rows[0].id,
      revisionNumber: 1,
      key: input.key,
      type: input.type,
    },
  });

  const artifact = await loadArtifactWithClient(client, input.organizationId, artifactId);
  if (!artifact) throw new ResourceNotFoundError("new artifact");
  return artifact;
}

export async function getArtifact(organizationId: string, artifactId: string) {
  const client = await getPool().connect();
  try {
    const artifact = await loadArtifactWithClient(client, organizationId, artifactId);
    if (!artifact) throw new ResourceNotFoundError("artifact");
    return artifact;
  } finally {
    client.release();
  }
}

export async function listProjectArtifacts(organizationId: string, projectId: string) {
  const result = await getPool().query<ArtifactRow>(
    `${ARTIFACT_SELECT}
     WHERE a.organization_id = $1 AND a.project_id = $2
     ORDER BY a.updated_at DESC, a.name ASC`,
    [organizationId, projectId],
  );
  return result.rows.map(mapArtifact);
}

export async function listOrganizationArtifacts(organizationId: string) {
  const result = await getPool().query<ArtifactRow>(
    `${ARTIFACT_SELECT}
     WHERE a.organization_id = $1
     ORDER BY a.updated_at DESC, a.name ASC`,
    [organizationId],
  );
  return result.rows.map(mapArtifact);
}

export async function createArtifact(input: {
  organizationId: string;
  projectId: string;
  principalId: string;
  key: string;
  name: string;
  type: ArtifactType;
  source: string;
}) {
  const validation = input.type === "FORM"
    ? validateFormSource(input.source)
    : input.type === "DMN_DECISION"
      ? await validateDmnXml(input.source)
      : await validateBpmnXml(input.source);

  try {
    return await withTransaction((client) => createArtifactWithClient(client, { ...input, validation }));
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateResourceError("key");
    if (isForeignKeyViolation(error)) throw new ResourceNotFoundError("project");
    throw error;
  }
}

export async function saveArtifactRevision(input: {
  organizationId: string;
  artifactId: string;
  principalId: string;
  baseRevisionId: string;
  source: string;
}) {
  const contentSha256 = sha256(input.source);

  return withTransaction(async (client) => {
    const locked = await client.query<{
      id: string;
      draft_head_revision_id: string;
      next_revision_number: number;
    }>(
      `SELECT id, draft_head_revision_id, next_revision_number
       FROM artifacts
       WHERE organization_id = $1 AND id = $2
       FOR UPDATE`,
      [input.organizationId, input.artifactId],
    );
    const artifactState = locked.rows[0];
    if (!artifactState) throw new ResourceNotFoundError("artifact");

    const current = await loadArtifactWithClient(client, input.organizationId, input.artifactId);
    if (!current) throw new ResourceNotFoundError("artifact");

    const validation = current.type === "FORM"
      ? validateFormSource(input.source)
      : current.type === "DMN_DECISION"
        ? await validateDmnXml(input.source)
        : await validateBpmnXml(input.source);

    if (current.revision.contentSha256 === contentSha256) {
      return { artifact: current, created: false };
    }
    if (artifactState.draft_head_revision_id !== input.baseRevisionId) {
      throw new RevisionConflictError(current.revision);
    }

    const revision = await client.query<{ id: string }>(
      `INSERT INTO artifact_revisions
        (organization_id, artifact_id, number, source, content_sha256, validation_status, validation, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        input.organizationId,
        input.artifactId,
        artifactState.next_revision_number,
        input.source,
        contentSha256,
        validation.status,
        JSON.stringify(validation),
        input.principalId,
      ],
    );

    await client.query(
      `UPDATE artifacts
       SET draft_head_revision_id = $1,
           next_revision_number = next_revision_number + 1,
           updated_at = now()
       WHERE id = $2`,
      [revision.rows[0].id, input.artifactId],
    );
    await insertAuditAndEvent(client, {
      organizationId: input.organizationId,
      actorId: input.principalId,
      action: "artifact.revision-created",
      resourceType: "artifact",
      resourceId: input.artifactId,
      eventType: "artifact.revision-created",
      payload: {
        artifactId: input.artifactId,
        revisionId: revision.rows[0].id,
        revisionNumber: artifactState.next_revision_number,
        baseRevisionId: input.baseRevisionId,
        validationStatus: validation.status,
      },
    });

    const artifact = await loadArtifactWithClient(client, input.organizationId, input.artifactId);
    if (!artifact) throw new ResourceNotFoundError("artifact");
    return { artifact, created: true };
  });
}

export async function createProject(input: {
  organizationId: string;
  workspaceId: string;
  principalId: string;
  key: string;
  name: string;
}): Promise<Project> {
  try {
    return await withTransaction(async (client) => {
      const result = await client.query<{
        id: string;
        organization_id: string;
        workspace_id: string;
        key: string;
        name: string;
      }>(
        `INSERT INTO projects (organization_id, workspace_id, key, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, organization_id, workspace_id, key, name`,
        [input.organizationId, input.workspaceId, input.key, input.name],
      );
      const project = result.rows[0];
      await ensureDefaultEnvironments(client, input.organizationId, project.id);
      await insertAuditAndEvent(client, {
        organizationId: input.organizationId,
        actorId: input.principalId,
        action: "project.created",
        resourceType: "project",
        resourceId: project.id,
        eventType: "project.created",
        payload: { projectId: project.id, workspaceId: project.workspace_id, key: project.key },
      });
      return {
        id: project.id,
        organizationId: project.organization_id,
        workspaceId: project.workspace_id,
        key: project.key,
        name: project.name,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateResourceError("key");
    throw error;
  }
}

export async function ensureLocalSetup(input: {
  organizationKey: string;
  workspaceKey: string;
  projectKey: string;
  artifactSource: string;
}): Promise<LocalSetup> {
  const validation = await validateBpmnXml(input.artifactSource);

  return withTransaction(async (client) => {
    const organizationResult = await client.query<{ id: string; key: string; name: string }>(
      `INSERT INTO organizations (key, name)
       VALUES ($1, 'Local organization')
       ON CONFLICT (key) DO UPDATE SET name = organizations.name
       RETURNING id, key, name`,
      [input.organizationKey],
    );
    const organization = organizationResult.rows[0];

    const workspaceResult = await client.query<{
      id: string;
      organization_id: string;
      key: string;
      name: string;
    }>(
      `INSERT INTO workspaces (organization_id, key, name)
       VALUES ($1, $2, 'Default workspace')
       ON CONFLICT (organization_id, key) DO UPDATE SET name = workspaces.name
       RETURNING id, organization_id, key, name`,
      [organization.id, input.workspaceKey],
    );
    const workspace = workspaceResult.rows[0];

    const principalResult = await client.query<{
      id: string;
      organization_id: string;
      email: string;
      display_name: string;
    }>(
      `INSERT INTO principals (organization_id, email, display_name)
       VALUES ($1, 'local@wanaflow.dev', 'Mariama Wane')
       ON CONFLICT (organization_id, email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id, organization_id, email, display_name`,
      [organization.id],
    );
    const principal = principalResult.rows[0];

    const projectResult = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      key: string;
      name: string;
    }>(
      `INSERT INTO projects (organization_id, workspace_id, key, name)
       VALUES ($1, $2, $3, 'People operations')
       ON CONFLICT (organization_id, workspace_id, key) DO UPDATE SET name = projects.name
       RETURNING id, organization_id, workspace_id, key, name`,
      [organization.id, workspace.id, input.projectKey],
    );
    const project = projectResult.rows[0];
    await ensureDefaultEnvironments(client, organization.id, project.id);

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM artifacts
       WHERE organization_id = $1 AND project_id = $2 AND key = 'employee-onboarding'`,
      [organization.id, project.id],
    );
    const artifact = existing.rows[0]
      ? await loadArtifactWithClient(client, organization.id, existing.rows[0].id)
      : await createArtifactWithClient(client, {
          organizationId: organization.id,
          projectId: project.id,
          principalId: principal.id,
          key: "employee-onboarding",
          name: "Employee onboarding",
          type: "BPMN_PROCESS",
          source: input.artifactSource,
          validation,
        });
    if (!artifact) throw new ResourceNotFoundError("local artifact");

    return {
      organization: { id: organization.id, key: organization.key, name: organization.name },
      workspace: {
        id: workspace.id,
        organizationId: workspace.organization_id,
        key: workspace.key,
        name: workspace.name,
      },
      project: {
        id: project.id,
        organizationId: project.organization_id,
        workspaceId: project.workspace_id,
        key: project.key,
        name: project.name,
      },
      principal: {
        id: principal.id,
        organizationId: principal.organization_id,
        email: principal.email,
        displayName: principal.display_name,
      },
      artifact,
    };
  });
}

export async function bootstrapFirstOwner(input: {
  authUserId: string;
  email: string;
  displayName: string;
  organizationKey: string;
  organizationName: string;
  workspaceKey: string;
  projectKey: string;
  artifactSource: string;
}): Promise<LocalSetup> {
  const validation = await validateBpmnXml(input.artifactSource);

  return withTransaction(async (client) => {
    const configured = await client.query(
      `SELECT 1
       FROM organization_memberships m
       JOIN principals p ON p.id = m.principal_id AND p.organization_id = m.organization_id
       WHERE p.auth_user_id IS NOT NULL
       LIMIT 1`,
    );
    if (configured.rowCount) throw new BootstrapUnavailableError();

    const organizations = await client.query<{ id: string; key: string; name: string }>(
      "SELECT id, key, name FROM organizations ORDER BY created_at ASC",
    );
    if (organizations.rows.length > 1) {
      throw new BootstrapUnavailableError(
        "Multiple unmanaged organizations exist; attach the first owner through an explicit recovery procedure.",
      );
    }

    const organization =
      organizations.rows[0] ??
      (
        await client.query<{ id: string; key: string; name: string }>(
          `INSERT INTO organizations (key, name)
           VALUES ($1, $2)
           RETURNING id, key, name`,
          [input.organizationKey, input.organizationName],
        )
      ).rows[0];

    const workspace = (
      await client.query<{
        id: string;
        organization_id: string;
        key: string;
        name: string;
      }>(
        `INSERT INTO workspaces (organization_id, key, name)
         VALUES ($1, $2, 'Default workspace')
         ON CONFLICT (organization_id, key) DO UPDATE SET name = workspaces.name
         RETURNING id, organization_id, key, name`,
        [organization.id, input.workspaceKey],
      )
    ).rows[0];

    const project = (
      await client.query<{
        id: string;
        organization_id: string;
        workspace_id: string;
        key: string;
        name: string;
      }>(
        `INSERT INTO projects (organization_id, workspace_id, key, name)
         VALUES ($1, $2, $3, 'People operations')
         ON CONFLICT (organization_id, workspace_id, key) DO UPDATE SET name = projects.name
         RETURNING id, organization_id, workspace_id, key, name`,
        [organization.id, workspace.id, input.projectKey],
      )
    ).rows[0];
    await ensureDefaultEnvironments(client, organization.id, project.id);

    const availablePrincipals = await client.query<{
      id: string;
      organization_id: string;
      email: string;
      display_name: string;
    }>(
      `SELECT id, organization_id, email, display_name
       FROM principals
       WHERE organization_id = $1 AND auth_user_id IS NULL
       ORDER BY created_at ASC`,
      [organization.id],
    );
    if (availablePrincipals.rows.length > 1) {
      throw new BootstrapUnavailableError(
        "Multiple unmanaged principals exist; attach the first owner through an explicit recovery procedure.",
      );
    }

    const principal = availablePrincipals.rows[0]
      ? (
          await client.query<{
            id: string;
            organization_id: string;
            email: string;
            display_name: string;
          }>(
            `UPDATE principals
             SET auth_user_id = $1, email = $2, display_name = $3
             WHERE id = $4
             RETURNING id, organization_id, email, display_name`,
            [input.authUserId, input.email, input.displayName, availablePrincipals.rows[0].id],
          )
        ).rows[0]
      : (
          await client.query<{
            id: string;
            organization_id: string;
            email: string;
            display_name: string;
          }>(
            `INSERT INTO principals
              (organization_id, auth_user_id, email, display_name)
             VALUES ($1, $2, $3, $4)
             RETURNING id, organization_id, email, display_name`,
            [organization.id, input.authUserId, input.email, input.displayName],
          )
        ).rows[0];

    await client.query(
      `INSERT INTO organization_memberships
        (organization_id, principal_id, role)
       VALUES ($1, $2, 'organization-owner')`,
      [organization.id, principal.id],
    );

    const existingArtifact = await client.query<{ id: string }>(
      `SELECT id FROM artifacts
       WHERE organization_id = $1 AND project_id = $2 AND key = 'employee-onboarding'`,
      [organization.id, project.id],
    );
    const artifact = existingArtifact.rows[0]
      ? await loadArtifactWithClient(client, organization.id, existingArtifact.rows[0].id)
      : await createArtifactWithClient(client, {
          organizationId: organization.id,
          projectId: project.id,
          principalId: principal.id,
          key: "employee-onboarding",
          name: "Employee onboarding",
          type: "BPMN_PROCESS",
          source: input.artifactSource,
          validation,
        });
    if (!artifact) throw new ResourceNotFoundError("bootstrap artifact");

    return {
      organization,
      workspace: {
        id: workspace.id,
        organizationId: workspace.organization_id,
        key: workspace.key,
        name: workspace.name,
      },
      project: {
        id: project.id,
        organizationId: project.organization_id,
        workspaceId: project.workspace_id,
        key: project.key,
        name: project.name,
      },
      principal: {
        id: principal.id,
        organizationId: principal.organization_id,
        authUserId: input.authUserId,
        email: principal.email,
        displayName: principal.display_name,
      },
      artifact,
    };
  });
}

export async function getLocalPrincipal(): Promise<Principal & { workspaceId: string }> {
  const organizationKey = process.env.WANAFLOW_LOCAL_ORGANIZATION_KEY ?? "local";
  const workspaceKey = process.env.WANAFLOW_LOCAL_WORKSPACE_KEY ?? "default";
  const result = await getPool().query<{
    id: string;
    organization_id: string;
    email: string;
    display_name: string;
    workspace_id: string;
  }>(
    `SELECT p.id, p.organization_id, p.email, p.display_name, w.id AS workspace_id
     FROM principals p
     JOIN organizations o ON o.id = p.organization_id
     JOIN workspaces w ON w.organization_id = o.id
     WHERE o.key = $1 AND w.key = $2 AND p.email = 'local@wanaflow.dev'`,
    [organizationKey, workspaceKey],
  );
  const principal = result.rows[0];
  if (!principal) throw new ResourceNotFoundError("local principal; run local setup first");
  return {
    id: principal.id,
    organizationId: principal.organization_id,
    email: principal.email,
    displayName: principal.display_name,
    workspaceId: principal.workspace_id,
  };
}
