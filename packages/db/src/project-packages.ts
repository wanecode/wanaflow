import { createHash } from "node:crypto";

import {
  validateBpmnXml,
  validateDmnXml,
  validateFormSource,
  type ArtifactValidationResult,
} from "@wanaflow/modeling";

import { assertPermission, assertProjectAccess, assertWorkspaceAccess } from "./authorization";
import { DuplicateResourceError, ResourceNotFoundError, RuntimePolicyError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type { ArtifactType, PrincipalContext, Project, ProjectPackage } from "./types";

function digest(source: string) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function stableKey(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(value)) {
    throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", `${label} must be a stable lowercase key.`);
  }
  return value;
}

export async function exportProjectPackage(
  context: PrincipalContext,
  projectId: string,
): Promise<ProjectPackage> {
  assertPermission(context, "project:read");
  await assertProjectAccess(context, projectId);
  const project = await getPool().query<{ key: string; name: string }>(
    "SELECT key, name FROM projects WHERE id = $1 AND organization_id = $2",
    [projectId, context.organization.id],
  );
  if (!project.rows[0]) throw new ResourceNotFoundError("project");
  const artifacts = await getPool().query<{
    key: string;
    name: string;
    type: ArtifactType;
    source: string;
    content_sha256: string;
  }>(
    `SELECT artifact.key, artifact.name, artifact.type, revision.source, revision.content_sha256
     FROM artifacts artifact
     JOIN artifact_revisions revision ON revision.id = artifact.draft_head_revision_id
     WHERE artifact.organization_id = $1 AND artifact.project_id = $2
     ORDER BY artifact.type, artifact.key`,
    [context.organization.id, projectId],
  );
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    project: project.rows[0],
    artifacts: artifacts.rows.map((artifact) => ({
      key: artifact.key,
      name: artifact.name,
      type: artifact.type,
      source: artifact.source,
      contentSha256: artifact.content_sha256,
    })),
  };
}

export async function importProjectPackage(
  context: PrincipalContext,
  workspaceId: string,
  input: unknown,
): Promise<Project> {
  assertPermission(context, "project:create");
  assertPermission(context, "artifact:create");
  await assertWorkspaceAccess(context, workspaceId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", "Choose a Wanaflow project package.");
  }
  const candidate = input as Partial<ProjectPackage>;
  if (candidate.schemaVersion !== 1 || !candidate.project || !Array.isArray(candidate.artifacts)) {
    throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", "This package version is not supported.");
  }
  const projectKey = stableKey(candidate.project.key, "Project key");
  const projectName = typeof candidate.project.name === "string" ? candidate.project.name.trim() : "";
  if (!projectName || projectName.length > 120 || candidate.artifacts.length > 250) {
    throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", "The project name or artifact count is outside supported limits.");
  }
  const seen = new Set<string>();
  const validated: Array<{
    key: string;
    name: string;
    type: ArtifactType;
    source: string;
    contentSha256: string;
    validation: ArtifactValidationResult;
  }> = [];
  for (const raw of candidate.artifacts) {
    const key = stableKey(raw.key, "Artifact key");
    if (seen.has(key)) throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", `Artifact key ${key} is duplicated.`);
    seen.add(key);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const source = typeof raw.source === "string" ? raw.source : "";
    const type = raw.type;
    if (!name || name.length > 160 || !["BPMN_PROCESS", "DMN_DECISION", "FORM"].includes(type) || !source || Buffer.byteLength(source, "utf8") > 2_097_152) {
      throw new RuntimePolicyError("INVALID_PROJECT_PACKAGE", `Artifact ${key} has invalid metadata or source.`);
    }
    const contentSha256 = digest(source);
    if (raw.contentSha256 !== contentSha256) {
      throw new RuntimePolicyError("PROJECT_PACKAGE_INTEGRITY", `Artifact ${key} does not match its recorded digest.`);
    }
    const validation = type === "FORM"
      ? validateFormSource(source)
      : type === "DMN_DECISION"
        ? await validateDmnXml(source)
        : await validateBpmnXml(source);
    validated.push({ key, name, type, source, contentSha256, validation });
  }

  try {
    return await withTransaction(async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO projects (organization_id, workspace_id, key, name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [context.organization.id, workspaceId, projectKey, projectName],
      );
      const projectId = created.rows[0].id;
      await client.query(
        `INSERT INTO environments (organization_id, project_id, key, name)
         VALUES ($1, $2, 'development', 'Development'),
                ($1, $2, 'staging', 'Staging'),
                ($1, $2, 'production', 'Production')`,
        [context.organization.id, projectId],
      );
      for (const artifact of validated) {
        const insertedArtifact = await client.query<{ id: string }>(
          `INSERT INTO artifacts (organization_id, project_id, key, name, type)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [context.organization.id, projectId, artifact.key, artifact.name, artifact.type],
        );
        const revision = await client.query<{ id: string }>(
          `INSERT INTO artifact_revisions
            (organization_id, artifact_id, number, source, content_sha256,
             validation_status, validation, created_by)
           VALUES ($1, $2, 1, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
          [context.organization.id, insertedArtifact.rows[0].id, artifact.source,
            artifact.contentSha256, artifact.validation.status,
            JSON.stringify(artifact.validation), context.principal.id],
        );
        await client.query(
          `UPDATE artifacts SET draft_head_revision_id = $1, next_revision_number = 2
           WHERE id = $2`,
          [revision.rows[0].id, insertedArtifact.rows[0].id],
        );
      }
      await client.query(
        `INSERT INTO audit_records
          (organization_id, actor_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, 'project.package-imported', 'project', $3, $4::jsonb)`,
        [context.organization.id, context.principal.id, projectId,
          JSON.stringify({ schemaVersion: 1, artifactCount: validated.length })],
      );
      return {
        id: projectId,
        organizationId: context.organization.id,
        workspaceId,
        key: projectKey,
        name: projectName,
      };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new DuplicateResourceError("key");
    }
    throw error;
  }
}
