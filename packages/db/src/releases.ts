import { createHash, randomUUID } from "node:crypto";

import type { ArtifactValidationResult } from "@wanaflow/modeling";
import type { PoolClient } from "pg";

import { assertPermission, assertProjectAccess } from "./authorization";
import { DuplicateResourceError, PublicationPolicyError, ResourceNotFoundError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type {
  ArtifactType,
  ArtifactVersion,
  Deployment,
  Environment,
  PrincipalContext,
  Publication,
  PublicationSummary,
} from "./types";

type PublicationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  review_id: string;
  manifest: Publication["manifest"];
  manifest_sha256: string;
  validation_snapshot: ArtifactValidationResult;
  approval_snapshot: Publication["approvalSnapshot"];
  published_by_id: string;
  published_by_name: string;
  published_by_email: string;
  created_at: Date;
  artifact_version: number;
  deployment_count: string;
};

type DeploymentRow = {
  id: string;
  publication_id: string;
  environment_id: string;
  environment_key: string;
  sequence: number;
  content_sha256: string;
  bundle_sha256: string;
  note: string;
  deployed_by_id: string;
  deployed_by_name: string;
  deployed_by_email: string;
  created_at: Date;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    publicationId: row.publication_id,
    environmentId: row.environment_id,
    environmentKey: row.environment_key,
    sequence: row.sequence,
    contentSha256: row.content_sha256,
    bundleSha256: row.bundle_sha256,
    note: row.note,
    deployedBy: {
      id: row.deployed_by_id,
      displayName: row.deployed_by_name,
      email: row.deployed_by_email,
    },
    createdAt: row.created_at.toISOString(),
  };
}

function mapPublicationSummary(row: PublicationRow): PublicationSummary {
  return {
    id: row.id,
    reviewId: row.review_id,
    artifactVersion: row.artifact_version,
    manifestSha256: row.manifest_sha256,
    publishedBy: {
      id: row.published_by_id,
      displayName: row.published_by_name,
      email: row.published_by_email,
    },
    deploymentCount: Number(row.deployment_count),
    createdAt: row.created_at.toISOString(),
  };
}

const PUBLICATION_SELECT = `
  SELECT
    p.id,
    p.organization_id,
    p.project_id,
    p.review_id,
    p.manifest,
    p.manifest_sha256,
    p.validation_snapshot,
    p.approval_snapshot,
    publisher.id AS published_by_id,
    publisher.display_name AS published_by_name,
    publisher.email AS published_by_email,
    p.created_at,
    root_version.number AS artifact_version,
    count(deployment.id)::text AS deployment_count
  FROM publications p
  JOIN reviews reviewed
    ON reviewed.id = p.review_id AND reviewed.organization_id = p.organization_id
  JOIN principals publisher
    ON publisher.id = p.published_by AND publisher.organization_id = p.organization_id
  JOIN artifact_versions root_version
    ON root_version.publication_id = p.id AND root_version.artifact_id = reviewed.artifact_id
  LEFT JOIN deployments deployment ON deployment.publication_id = p.id
`;

async function loadPublicationRow(
  context: PrincipalContext,
  predicate: "p.id = $1" | "p.review_id = $1",
  id: string,
) {
  const result = await getPool().query<PublicationRow>(
    `${PUBLICATION_SELECT}
     WHERE ${predicate} AND p.organization_id = $2
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM projects scoped
         WHERE scoped.id = p.project_id AND scoped.workspace_id = $3
       ))
     GROUP BY p.id, publisher.id, root_version.number`,
    [id, context.organization.id, context.workspaceScopeId],
  );
  return result.rows[0] ?? null;
}

async function loadDeployments(
  context: PrincipalContext,
  input: { publicationId?: string; environmentId?: string },
) {
  const filters = ["d.organization_id = $1"];
  const values: string[] = [context.organization.id];
  if (input.publicationId) {
    values.push(input.publicationId);
    filters.push(`d.publication_id = $${values.length}`);
  }
  if (input.environmentId) {
    values.push(input.environmentId);
    filters.push(`d.environment_id = $${values.length}`);
  }
  const result = await getPool().query<DeploymentRow>(
    `SELECT
       d.id,
       d.publication_id,
       d.environment_id,
       environment.key AS environment_key,
       d.sequence,
       d.content_sha256,
       d.bundle_sha256,
       d.note,
       deployer.id AS deployed_by_id,
       deployer.display_name AS deployed_by_name,
       deployer.email AS deployed_by_email,
       d.created_at
     FROM deployments d
     JOIN environments environment
       ON environment.id = d.environment_id AND environment.organization_id = d.organization_id
     JOIN principals deployer
       ON deployer.id = d.deployed_by AND deployer.organization_id = d.organization_id
     JOIN projects project
       ON project.id = d.project_id AND project.organization_id = d.organization_id
     WHERE ${filters.join(" AND ")}
       AND ($${values.length + 1}::uuid IS NULL OR project.workspace_id = $${values.length + 1})
     ORDER BY d.created_at DESC, d.id DESC`,
    [...values, context.workspaceScopeId],
  );
  return result.rows.map(mapDeployment);
}

async function insertAuditAndEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    actorId: string;
    action: string;
    resourceType: "environment" | "publication" | "deployment";
    resourceId: string;
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
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.payload),
    ],
  );
}

export async function findPublicationForReview(
  context: PrincipalContext,
  reviewId: string,
): Promise<PublicationSummary | null> {
  const row = await loadPublicationRow(context, "p.review_id = $1", reviewId);
  return row ? mapPublicationSummary(row) : null;
}

export async function getPublication(
  context: PrincipalContext,
  publicationId: string,
): Promise<Publication> {
  assertPermission(context, "publication:read");
  const row = await loadPublicationRow(context, "p.id = $1", publicationId);
  if (!row) throw new ResourceNotFoundError("publication");
  const [versionResult, deployments] = await Promise.all([
    getPool().query<{
      id: string;
      artifact_id: string;
      artifact_key: string;
      artifact_name: string;
      artifact_type: ArtifactType;
      revision_id: string;
      revision_number: number;
      number: number;
      content_sha256: string;
      created_at: Date;
    }>(
      `SELECT
         av.id,
         artifact.id AS artifact_id,
         artifact.key AS artifact_key,
         artifact.name AS artifact_name,
         artifact.type AS artifact_type,
         revision.id AS revision_id,
         revision.number AS revision_number,
         av.number,
         revision.content_sha256,
         av.created_at
       FROM artifact_versions av
       JOIN artifacts artifact ON artifact.id = av.artifact_id
       JOIN artifact_revisions revision
         ON revision.id = av.revision_id AND revision.artifact_id = av.artifact_id
       WHERE av.publication_id = $1 AND av.organization_id = $2
       ORDER BY artifact.key ASC`,
      [publicationId, context.organization.id],
    ),
    loadDeployments(context, { publicationId }),
  ]);
  const artifactVersions: ArtifactVersion[] = versionResult.rows.map((version) => ({
    id: version.id,
    artifact: {
      id: version.artifact_id,
      key: version.artifact_key,
      name: version.artifact_name,
      type: version.artifact_type,
    },
    revisionId: version.revision_id,
    revisionNumber: version.revision_number,
    version: version.number,
    contentSha256: version.content_sha256,
    createdAt: version.created_at.toISOString(),
  }));
  return {
    ...mapPublicationSummary(row),
    organizationId: row.organization_id,
    projectId: row.project_id,
    manifest: row.manifest,
    validationSnapshot: row.validation_snapshot,
    approvalSnapshot: row.approval_snapshot,
    artifactVersions,
    deployments,
  };
}

export async function getDeployment(
  context: PrincipalContext,
  deploymentId: string,
): Promise<Deployment> {
  assertPermission(context, "deployment:read");
  const deployments = await loadDeployments(context, {});
  const deployment = deployments.find((candidate) => candidate.id === deploymentId);
  if (!deployment) throw new ResourceNotFoundError("deployment");
  return deployment;
}

export async function createPublication(context: PrincipalContext, reviewId: string) {
  assertPermission(context, "publication:create");
  const publicationId = await withTransaction(async (client) => {
    const locked = await client.query<{
      review_id: string;
      project_id: string;
      artifact_id: string;
      artifact_key: string;
      artifact_type: ArtifactType;
      revision_id: string;
      revision_number: number;
      content_sha256: string;
      validation: ArtifactValidationResult;
      validation_status: "VALID" | "INVALID";
      status: string;
      decision_id: string | null;
      decision_outcome: string | null;
      decision_note: string | null;
      decision_created_at: Date | null;
      decided_by_id: string | null;
      decided_by_name: string | null;
      decided_by_email: string | null;
    }>(
      `SELECT
         review.id AS review_id,
         review.project_id,
         review.artifact_id,
         artifact.key AS artifact_key,
         artifact.type AS artifact_type,
         revision.id AS revision_id,
         revision.number AS revision_number,
         revision.content_sha256,
         revision.validation,
         revision.validation_status,
         review.status,
         decision.id AS decision_id,
         decision.outcome AS decision_outcome,
         decision.note AS decision_note,
         decision.created_at AS decision_created_at,
         decider.id AS decided_by_id,
         decider.display_name AS decided_by_name,
         decider.email AS decided_by_email
       FROM reviews review
       JOIN projects project
         ON project.id = review.project_id AND project.organization_id = review.organization_id
       JOIN artifacts artifact
         ON artifact.id = review.artifact_id AND artifact.organization_id = review.organization_id
       JOIN artifact_revisions revision
         ON revision.id = review.revision_id AND revision.artifact_id = review.artifact_id
       LEFT JOIN review_decisions decision ON decision.review_id = review.id
       LEFT JOIN principals decider
         ON decider.id = decision.decided_by AND decider.organization_id = review.organization_id
       WHERE review.id = $1 AND review.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF review`,
      [reviewId, context.organization.id, context.workspaceScopeId],
    );
    const review = locked.rows[0];
    if (!review) throw new ResourceNotFoundError("review");

    const existing = await client.query<{ id: string }>(
      "SELECT id FROM publications WHERE review_id = $1 AND organization_id = $2",
      [reviewId, context.organization.id],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    if (
      review.status !== "APPROVED" ||
      review.validation_status !== "VALID" ||
      review.decision_outcome !== "APPROVED" ||
      !review.decision_id ||
      !review.decision_created_at ||
      !review.decided_by_id ||
      !review.decided_by_name ||
      !review.decided_by_email
    ) {
      throw new PublicationPolicyError(
        "PUBLICATION_NOT_ELIGIBLE",
        "Only an approved, valid review can be published.",
      );
    }

    const dependencyResult = await client.query<{
      artifact_id: string;
      artifact_key: string;
      artifact_type: ArtifactType;
      revision_id: string;
      content_sha256: string;
      validation_status: "VALID" | "INVALID";
    }>(
      `SELECT dependency.artifact_id, dependency.artifact_key,
         dependency.artifact_type, dependency.revision_id,
         revision.content_sha256, revision.validation_status
       FROM review_artifact_dependencies dependency
       JOIN artifact_revisions revision
         ON revision.id = dependency.revision_id AND revision.artifact_id = dependency.artifact_id
       WHERE dependency.review_id = $1
       ORDER BY dependency.artifact_id`,
      [reviewId],
    );
    if (dependencyResult.rows.some((dependency) => dependency.validation_status !== "VALID")) {
      throw new PublicationPolicyError("PUBLICATION_DEPENDENCY_INVALID", "A dependency pinned by this review is not valid.");
    }
    const subjects = [
      {
        artifact_id: review.artifact_id,
        artifact_key: review.artifact_key,
        artifact_type: review.artifact_type,
        revision_id: review.revision_id,
        content_sha256: review.content_sha256,
      },
      ...dependencyResult.rows,
    ];
    await client.query(
      "SELECT id FROM artifacts WHERE id = ANY($1::uuid[]) AND organization_id = $2 ORDER BY id FOR UPDATE",
      [subjects.map((subject) => subject.artifact_id), context.organization.id],
    );
    const versionNumbers = new Map<string, number>();
    for (const subject of subjects) {
      const nextVersion = await client.query<{ number: number }>(
        `SELECT (coalesce(max(number), 0) + 1)::integer AS number
         FROM artifact_versions WHERE artifact_id = $1`,
        [subject.artifact_id],
      );
      versionNumbers.set(subject.artifact_id, nextVersion.rows[0].number);
    }
    const version = versionNumbers.get(review.artifact_id)!;
    const id = randomUUID();
    const manifest: Publication["manifest"] = {
      schemaVersion: 1,
      artifacts: subjects.map((subject) => ({
        artifactId: subject.artifact_id,
        revisionId: subject.revision_id,
        key: subject.artifact_key,
        type: subject.artifact_type,
        version: versionNumbers.get(subject.artifact_id)!,
        contentSha256: subject.content_sha256,
      })),
    };
    const manifestSha256 = sha256(JSON.stringify(manifest));
    const approvalSnapshot: Publication["approvalSnapshot"] = {
      reviewId,
      decisionId: review.decision_id,
      outcome: "APPROVED",
      decidedBy: {
        id: review.decided_by_id,
        displayName: review.decided_by_name,
        email: review.decided_by_email,
      },
      decidedAt: review.decision_created_at.toISOString(),
      note: review.decision_note,
    };
    await client.query(
      `INSERT INTO publications
        (id, organization_id, project_id, review_id, manifest, manifest_sha256,
         validation_snapshot, approval_snapshot, published_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        id,
        context.organization.id,
        review.project_id,
        reviewId,
        JSON.stringify(manifest),
        manifestSha256,
        JSON.stringify(review.validation),
        JSON.stringify(approvalSnapshot),
        context.principal.id,
      ],
    );
    for (const subject of subjects) {
      await client.query(
        `INSERT INTO artifact_versions
          (id, organization_id, artifact_id, revision_id, publication_id, number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), context.organization.id, subject.artifact_id, subject.revision_id, id, versionNumbers.get(subject.artifact_id)],
      );
    }
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "publication.created",
      resourceType: "publication",
      resourceId: id,
      payload: {
        publicationId: id,
        reviewId,
        artifactId: review.artifact_id,
        revisionId: review.revision_id,
        artifactVersion: version,
        manifestSha256,
      },
    });
    return id;
  });
  return getPublication(context, publicationId);
}

export async function createEnvironment(
  context: PrincipalContext,
  input: { projectId: string; key: string; name: string },
): Promise<Environment> {
  assertPermission(context, "environment:create");
  await assertProjectAccess(context, input.projectId);
  try {
    const environmentId = await withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO environments (organization_id, project_id, key, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [context.organization.id, input.projectId, input.key, input.name],
      );
      const id = result.rows[0].id;
      await insertAuditAndEvent(client, {
        organizationId: context.organization.id,
        actorId: context.principal.id,
        action: "environment.created",
        resourceType: "environment",
        resourceId: id,
        payload: { environmentId: id, projectId: input.projectId, key: input.key },
      });
      return id;
    });
    const environments = await listProjectEnvironments(context, input.projectId);
    const environment = environments.find((candidate) => candidate.id === environmentId);
    if (!environment) throw new ResourceNotFoundError("environment");
    return environment;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new DuplicateResourceError("key");
    }
    throw error;
  }
}

export async function listProjectEnvironments(
  context: PrincipalContext,
  projectId: string,
): Promise<Environment[]> {
  assertPermission(context, "environment:read");
  await assertProjectAccess(context, projectId);
  const result = await getPool().query<{
    id: string;
    organization_id: string;
    project_id: string;
    key: string;
    name: string;
    created_at: Date;
  }>(
    `SELECT id, organization_id, project_id, key, name, created_at
     FROM environments
     WHERE organization_id = $1 AND project_id = $2
     ORDER BY CASE key WHEN 'development' THEN 1 WHEN 'staging' THEN 2 WHEN 'production' THEN 3 ELSE 4 END,
       created_at ASC`,
    [context.organization.id, projectId],
  );
  const deployments = await loadDeployments(context, {});
  return result.rows.map((environment) => {
    const environmentDeployments = deployments.filter(
      (deployment) => deployment.environmentId === environment.id,
    );
    return {
      id: environment.id,
      organizationId: environment.organization_id,
      projectId: environment.project_id,
      key: environment.key,
      name: environment.name,
      deploymentCount: environmentDeployments.length,
      latestDeployment: environmentDeployments[0] ?? null,
      createdAt: environment.created_at.toISOString(),
    };
  });
}

export async function deployPublication(
  context: PrincipalContext,
  input: { environmentId: string; publicationId: string; note: string },
): Promise<Deployment> {
  assertPermission(context, "deployment:create");
  const deploymentId = await withTransaction(async (client) => {
    const environmentResult = await client.query<{
      id: string;
      project_id: string;
      key: string;
    }>(
      `SELECT environment.id, environment.project_id, environment.key
       FROM environments environment
       JOIN projects project
         ON project.id = environment.project_id AND project.organization_id = environment.organization_id
       WHERE environment.id = $1 AND environment.organization_id = $2
         AND ($3::uuid IS NULL OR project.workspace_id = $3)
       FOR UPDATE OF environment`,
      [input.environmentId, context.organization.id, context.workspaceScopeId],
    );
    const environment = environmentResult.rows[0];
    if (!environment) throw new ResourceNotFoundError("environment");
    const publicationResult = await client.query<{
      id: string;
      project_id: string;
      manifest: Publication["manifest"];
      manifest_sha256: string;
    }>(
      `SELECT id, project_id, manifest, manifest_sha256
       FROM publications
       WHERE id = $1 AND organization_id = $2 AND project_id = $3`,
      [input.publicationId, context.organization.id, environment.project_id],
    );
    const publication = publicationResult.rows[0];
    if (!publication) throw new ResourceNotFoundError("publication");
    const sources = await client.query<{
      artifact_id: string;
      revision_id: string;
      key: string;
      type: ArtifactType;
      number: number;
      content_sha256: string;
      source: string;
    }>(
      `SELECT
         artifact.id AS artifact_id,
         revision.id AS revision_id,
         artifact.key,
         artifact.type,
         version.number,
         revision.content_sha256,
         revision.source
       FROM artifact_versions version
       JOIN artifacts artifact ON artifact.id = version.artifact_id
       JOIN artifact_revisions revision
         ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
       WHERE version.publication_id = $1
       ORDER BY artifact.key ASC`,
      [publication.id],
    );
    if (!sources.rows.length) {
      throw new PublicationPolicyError("PUBLICATION_EMPTY", "The publication has no artifact versions.");
    }
    const sequenceResult = await client.query<{ sequence: number }>(
      `SELECT (coalesce(max(sequence), 0) + 1)::integer AS sequence
       FROM deployments WHERE environment_id = $1`,
      [environment.id],
    );
    const sequence = sequenceResult.rows[0].sequence;
    const bundle = {
      schemaVersion: 1,
      publicationId: publication.id,
      manifestSha256: publication.manifest_sha256,
      environment: { id: environment.id, key: environment.key },
      executionProfile: "wanaflow-bpmn-v1",
      artifacts: sources.rows.map((artifact) => ({
        artifactId: artifact.artifact_id,
        revisionId: artifact.revision_id,
        key: artifact.key,
        type: artifact.type,
        version: artifact.number,
        contentSha256: artifact.content_sha256,
        source: artifact.source,
      })),
    };
    const bundleSha256 = sha256(JSON.stringify(bundle));
    const id = randomUUID();
    await client.query(
      `INSERT INTO deployments
        (id, organization_id, project_id, environment_id, publication_id, sequence,
         content_sha256, bundle_sha256, bundle, note, deployed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        id,
        context.organization.id,
        environment.project_id,
        environment.id,
        publication.id,
        sequence,
        publication.manifest_sha256,
        bundleSha256,
        JSON.stringify(bundle),
        input.note.trim(),
        context.principal.id,
      ],
    );
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      action: "deployment.created",
      resourceType: "deployment",
      resourceId: id,
      payload: {
        deploymentId: id,
        publicationId: publication.id,
        environmentId: environment.id,
        environmentKey: environment.key,
        sequence,
        contentSha256: publication.manifest_sha256,
        bundleSha256,
      },
    });
    return id;
  });
  const deployments = await loadDeployments(context, {});
  const deployment = deployments.find((candidate) => candidate.id === deploymentId);
  if (!deployment) throw new ResourceNotFoundError("deployment");
  return deployment;
}
