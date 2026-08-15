import {
  listBpmnElements,
  listBpmnDecisionBindings,
  listBpmnFormBindings,
  listDmnElements,
  listFormFieldKeys,
  parseDmnDecision,
  parseFormSource,
} from "@wanaflow/modeling";
import type { PoolClient } from "pg";

import {
  ResourceNotFoundError,
  ReviewPolicyError,
  ReviewStateConflictError,
} from "./errors";
import { assertPermission, assertProjectAccess } from "./authorization";
import { getArtifact } from "./artifacts";
import { insertNotification } from "./notifications";
import { getPool, withTransaction } from "./pool";
import { findPublicationForReview } from "./releases";
import type {
  ArtifactRevision,
  MembershipRole,
  PrincipalContext,
  Review,
  ReviewActivity,
  ReviewAssignment,
  ReviewComment,
  ReviewDecision,
  ReviewerCandidate,
  ReviewListItem,
  ReviewOutcome,
  ReviewPrincipal,
  ReviewStatus,
} from "./types";

type ReviewRow = {
  id: string;
  organization_id: string;
  project_id: string;
  artifact_id: string;
  artifact_key: string;
  artifact_name: string;
  artifact_type: "BPMN_PROCESS" | "DMN_DECISION" | "FORM";
  revision_id: string;
  revision_number: number;
  source: string;
  content_sha256: string;
  validation: ArtifactRevision["validation"];
  revision_created_at: Date;
  revision_created_by_id: string;
  revision_created_by_name: string;
  status: ReviewStatus;
  summary: string;
  requested_by_id: string;
  requested_by_name: string;
  requested_by_email: string;
  created_at: Date;
  decided_at: Date | null;
  cancelled_at: Date | null;
};

const REVIEW_SELECT = `
  SELECT
    rv.id,
    rv.organization_id,
    rv.project_id,
    rv.artifact_id,
    a.key AS artifact_key,
    a.name AS artifact_name,
    a.type AS artifact_type,
    rv.revision_id,
    ar.number AS revision_number,
    ar.source,
    ar.content_sha256,
    ar.validation,
    ar.created_at AS revision_created_at,
    author.id AS revision_created_by_id,
    author.display_name AS revision_created_by_name,
    rv.status,
    rv.summary,
    requester.id AS requested_by_id,
    requester.display_name AS requested_by_name,
    requester.email AS requested_by_email,
    rv.created_at,
    rv.decided_at,
    rv.cancelled_at
  FROM reviews rv
  JOIN artifacts a ON a.id = rv.artifact_id AND a.organization_id = rv.organization_id
  JOIN artifact_revisions ar ON ar.id = rv.revision_id AND ar.artifact_id = rv.artifact_id
  JOIN principals author ON author.id = ar.created_by AND author.organization_id = rv.organization_id
  JOIN principals requester ON requester.id = rv.requested_by AND requester.organization_id = rv.organization_id
`;

function principal(id: string, displayName: string, email: string): ReviewPrincipal {
  return { id, displayName, email };
}

async function insertAuditAndEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    actorId: string;
    reviewId: string;
    action: string;
    details: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO audit_records
      (organization_id, actor_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, 'review', $4, $5::jsonb)`,
    [
      input.organizationId,
      input.actorId,
      input.action,
      input.reviewId,
      JSON.stringify(input.details),
    ],
  );
  await client.query(
    `INSERT INTO outbox_events
      (organization_id, type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, 'review', $3, $4::jsonb)`,
    [
      input.organizationId,
      input.action,
      input.reviewId,
      JSON.stringify({ reviewId: input.reviewId, ...input.details }),
    ],
  );
}

async function loadReviewRow(context: PrincipalContext, reviewId: string) {
  const result = await getPool().query<ReviewRow>(
    `${REVIEW_SELECT}
     WHERE rv.id = $1 AND rv.organization_id = $2
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM projects scoped
         WHERE scoped.id = rv.project_id AND scoped.workspace_id = $3
       ))
       AND ($4::boolean = false OR rv.requested_by = $5 OR EXISTS (
         SELECT 1 FROM review_assignments assigned
         WHERE assigned.review_id = rv.id AND assigned.principal_id = $5
       ))`,
    [
      reviewId,
      context.organization.id,
      context.workspaceScopeId,
      context.role === "reviewer",
      context.principal.id,
    ],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("review");
  return result.rows[0];
}

async function loadAssignments(reviewId: string): Promise<ReviewAssignment[]> {
  const result = await getPool().query<{
    id: string;
    created_at: Date;
    reviewer_id: string;
    reviewer_name: string;
    reviewer_email: string;
    assigned_by_id: string;
    assigned_by_name: string;
    assigned_by_email: string;
  }>(
    `SELECT
       ra.id,
       ra.created_at,
       reviewer.id AS reviewer_id,
       reviewer.display_name AS reviewer_name,
       reviewer.email AS reviewer_email,
       assigner.id AS assigned_by_id,
       assigner.display_name AS assigned_by_name,
       assigner.email AS assigned_by_email
     FROM review_assignments ra
     JOIN principals reviewer ON reviewer.id = ra.principal_id
     JOIN principals assigner ON assigner.id = ra.assigned_by
     WHERE ra.review_id = $1
     ORDER BY ra.created_at ASC, reviewer.display_name ASC`,
    [reviewId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    reviewer: principal(row.reviewer_id, row.reviewer_name, row.reviewer_email),
    assignedBy: principal(row.assigned_by_id, row.assigned_by_name, row.assigned_by_email),
    createdAt: row.created_at.toISOString(),
  }));
}

async function loadComments(reviewId: string): Promise<ReviewComment[]> {
  const result = await getPool().query<{
    id: string;
    element_id: string;
    element_name: string;
    body: string;
    created_at: Date;
    resolved_at: Date | null;
    author_id: string;
    author_name: string;
    author_email: string;
    resolver_id: string | null;
    resolver_name: string | null;
    resolver_email: string | null;
  }>(
    `SELECT
       rc.id,
       rc.element_id,
       rc.element_name,
       rc.body,
       rc.created_at,
       rc.resolved_at,
       author.id AS author_id,
       author.display_name AS author_name,
       author.email AS author_email,
       resolver.id AS resolver_id,
       resolver.display_name AS resolver_name,
       resolver.email AS resolver_email
     FROM review_comments rc
     JOIN principals author ON author.id = rc.created_by
     LEFT JOIN principals resolver ON resolver.id = rc.resolved_by
     WHERE rc.review_id = $1
     ORDER BY rc.created_at ASC`,
    [reviewId],
  );
  const mentions = await getPool().query<{
    comment_id: string;
    principal_id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT mention.comment_id, principal.id AS principal_id,
       principal.display_name, principal.email
     FROM review_comment_mentions mention
     JOIN principals principal
       ON principal.id = mention.principal_id AND principal.organization_id = mention.organization_id
     WHERE mention.review_id = $1
     ORDER BY principal.display_name`,
    [reviewId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    elementId: row.element_id,
    elementName: row.element_name,
    body: row.body,
    author: principal(row.author_id, row.author_name, row.author_email),
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedBy:
      row.resolver_id && row.resolver_name && row.resolver_email
        ? principal(row.resolver_id, row.resolver_name, row.resolver_email)
        : null,
    mentions: mentions.rows
      .filter((mention) => mention.comment_id === row.id)
      .map((mention) => principal(mention.principal_id, mention.display_name, mention.email)),
  }));
}

async function loadChangeSummary(row: ReviewRow) {
  const previous = await getPool().query<{
    number: number;
    source: string;
    content_sha256: string;
  }>(
    `SELECT number, source, content_sha256
     FROM artifact_revisions
     WHERE artifact_id = $1 AND number < $2
     ORDER BY number DESC
     LIMIT 1`,
    [row.artifact_id, row.revision_number],
  );
  const prior = previous.rows[0];
  if (!prior) {
    return {
      previousRevisionNumber: null,
      sourceChanged: false,
      addedElements: [],
      removedElements: [],
    };
  }
  const [currentElements, previousElements] = await Promise.all([
    row.artifact_type === "DMN_DECISION" ? listDmnElements(row.source) : listBpmnElements(row.source),
    row.artifact_type === "DMN_DECISION" ? listDmnElements(prior.source) : listBpmnElements(prior.source),
  ]);
  const currentIds = new Set(currentElements.map((element) => element.id));
  const previousIds = new Set(previousElements.map((element) => element.id));
  return {
    previousRevisionNumber: prior.number,
    sourceChanged: prior.content_sha256 !== row.content_sha256,
    addedElements: currentElements.filter((element) => !previousIds.has(element.id)),
    removedElements: previousElements.filter((element) => !currentIds.has(element.id)),
  };
}

async function loadDecision(reviewId: string): Promise<ReviewDecision | null> {
  const result = await getPool().query<{
    id: string;
    outcome: ReviewOutcome;
    note: string | null;
    created_at: Date;
    principal_id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT rd.id, rd.outcome, rd.note, rd.created_at,
       p.id AS principal_id, p.display_name, p.email
     FROM review_decisions rd
     JOIN principals p ON p.id = rd.decided_by
     WHERE rd.review_id = $1`,
    [reviewId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        outcome: row.outcome,
        note: row.note,
        decidedBy: principal(row.principal_id, row.display_name, row.email),
        createdAt: row.created_at.toISOString(),
      }
    : null;
}

async function loadActivity(reviewId: string): Promise<ReviewActivity[]> {
  const result = await getPool().query<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    created_at: Date;
    principal_id: string;
    display_name: string;
    email: string;
  }>(
    `SELECT a.id, a.action, a.details, a.created_at,
       p.id AS principal_id, p.display_name, p.email
     FROM audit_records a
     JOIN principals p ON p.id = a.actor_id
     WHERE (a.resource_type = 'review' AND a.resource_id = $1)
       OR (a.resource_type = 'publication' AND EXISTS (
         SELECT 1 FROM publications publication
         WHERE publication.id = a.resource_id AND publication.review_id = $1
       ))
       OR (a.resource_type = 'deployment' AND EXISTS (
         SELECT 1
         FROM deployments deployment
         JOIN publications publication ON publication.id = deployment.publication_id
         WHERE deployment.id = a.resource_id AND publication.review_id = $1
       ))
     ORDER BY a.created_at ASC`,
    [reviewId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: principal(row.principal_id, row.display_name, row.email),
    details: row.details,
    createdAt: row.created_at.toISOString(),
  }));
}

async function loadDependencies(reviewId: string) {
  const result = await getPool().query<{
    artifact_id: string;
    artifact_key: string;
    artifact_name: string;
    artifact_type: "FORM" | "DMN_DECISION";
    revision_id: string;
    revision_number: number;
    content_sha256: string;
  }>(
    `SELECT dependency.artifact_id, dependency.artifact_key,
       artifact.name AS artifact_name, dependency.artifact_type,
       dependency.revision_id, revision.number AS revision_number,
       revision.content_sha256
     FROM review_artifact_dependencies dependency
     JOIN artifacts artifact ON artifact.id = dependency.artifact_id
     JOIN artifact_revisions revision
       ON revision.id = dependency.revision_id AND revision.artifact_id = dependency.artifact_id
     WHERE dependency.review_id = $1
     ORDER BY dependency.artifact_key`,
    [reviewId],
  );
  return result.rows.map((dependency) => ({
    artifact: {
      id: dependency.artifact_id,
      key: dependency.artifact_key,
      name: dependency.artifact_name,
      type: dependency.artifact_type,
    },
    revisionId: dependency.revision_id,
    revisionNumber: dependency.revision_number,
    contentSha256: dependency.content_sha256,
  }));
}

function decisionAuthorityBlockedReason(
  context: PrincipalContext,
  row: ReviewRow,
  assignments: ReviewAssignment[],
) {
  if (row.status !== "OPEN") return "This review is already closed.";
  if (!context.permissions.includes("review:decide")) return "Your role cannot decide reviews.";
  if (!assignments.some((assignment) => assignment.reviewer.id === context.principal.id)) {
    return "Only an assigned reviewer can decide this review.";
  }
  if (row.requested_by_id === context.principal.id) return "The requester cannot approve their own review.";
  if (row.revision_created_by_id === context.principal.id) return "The revision author cannot approve their own work.";
  return null;
}

export async function getReview(context: PrincipalContext, reviewId: string): Promise<Review> {
  assertPermission(context, "review:read");
  const row = await loadReviewRow(context, reviewId);
  const [assignments, comments, decision, activity, elements, dependencies, eligibility, publication, changes] = await Promise.all([
    loadAssignments(reviewId),
    loadComments(reviewId),
    loadDecision(reviewId),
    loadActivity(reviewId),
    row.artifact_type === "DMN_DECISION" ? listDmnElements(row.source) : listBpmnElements(row.source),
    loadDependencies(reviewId),
    getPool().query("SELECT 1 FROM publication_eligible_revisions WHERE review_id = $1", [reviewId]),
    findPublicationForReview(context, reviewId),
    loadChangeSummary(row),
  ]);
  const unresolvedComments = comments.filter((comment) => !comment.resolvedAt).length;
  const authorityBlockedReason = decisionAuthorityBlockedReason(context, row, assignments);
  const approvalBlockedReason =
    authorityBlockedReason ??
    (row.validation.status !== "VALID"
      ? "This revision is not structurally valid."
      : unresolvedComments
        ? "Resolve open comments before approval."
        : null);
  const canCancel =
    row.status === "OPEN" &&
    context.permissions.includes("review:cancel") &&
    (row.requested_by_id === context.principal.id ||
      context.role === "organization-owner" ||
      context.role === "workspace-admin");

  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    artifact: {
      id: row.artifact_id,
      key: row.artifact_key,
      name: row.artifact_name,
      type: row.artifact_type,
    },
    revision: {
      id: row.revision_id,
      artifactId: row.artifact_id,
      number: row.revision_number,
      source: row.source,
      contentSha256: row.content_sha256,
      validation: row.validation,
      createdAt: row.revision_created_at.toISOString(),
      createdBy: {
        id: row.revision_created_by_id,
        displayName: row.revision_created_by_name,
      },
    },
    dependencies,
    status: row.status,
    summary: row.summary,
    requestedBy: principal(row.requested_by_id, row.requested_by_name, row.requested_by_email),
    assignments,
    comments,
    decision,
    activity,
    publicationEligible: Boolean(eligibility.rowCount),
    publication,
    capabilities: {
      canComment: row.status === "OPEN" && context.permissions.includes("review:comment"),
      canDecide: authorityBlockedReason === null,
      canCancel,
      canPublish:
        Boolean(eligibility.rowCount) &&
        !publication &&
        context.permissions.includes("publication:create"),
      canDeploy: Boolean(publication) && context.permissions.includes("deployment:create"),
      decisionBlockedReason: approvalBlockedReason,
    },
    elements,
    changes,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
  };
}

export async function listReviews(context: PrincipalContext): Promise<ReviewListItem[]> {
  assertPermission(context, "review:read");
  const result = await getPool().query<{ id: string }>(
    `SELECT DISTINCT rv.id, rv.created_at
     FROM reviews rv
     WHERE rv.organization_id = $1
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM projects scoped
         WHERE scoped.id = rv.project_id AND scoped.workspace_id = $2
       ))
       AND ($3::boolean = false OR rv.requested_by = $4 OR EXISTS (
         SELECT 1 FROM review_assignments ra
         WHERE ra.review_id = rv.id AND ra.principal_id = $4
       ))
     ORDER BY rv.created_at DESC`,
    [context.organization.id, context.workspaceScopeId, context.role === "reviewer", context.principal.id],
  );
  return Promise.all(
    result.rows.map(async ({ id }) => {
      const review = await getReview(context, id);
      const { comments, activity: _activity, elements: _elements, dependencies: _dependencies, ...item } = review;
      return {
        ...item,
        commentCount: comments.length,
        unresolvedCommentCount: comments.filter((comment) => !comment.resolvedAt).length,
      };
    }),
  );
}

export async function listReviewerCandidates(
  context: PrincipalContext,
  artifactId: string,
): Promise<ReviewerCandidate[]> {
  assertPermission(context, "review:create");
  const artifact = await getArtifact(context.organization.id, artifactId);
  await assertProjectAccess(context, artifact.projectId);
  const result = await getPool().query<{
    id: string;
    display_name: string;
    email: string;
    role: Extract<MembershipRole, "organization-owner" | "workspace-admin" | "reviewer">;
  }>(
    `SELECT DISTINCT ON (p.id)
       p.id, p.display_name, p.email, m.role
     FROM principals p
     JOIN organization_memberships m
       ON m.principal_id = p.id AND m.organization_id = p.organization_id
     JOIN projects project ON project.id = $2 AND project.organization_id = p.organization_id
     WHERE p.organization_id = $1
       AND m.role IN ('organization-owner', 'workspace-admin', 'reviewer')
       AND (m.workspace_id IS NULL OR m.workspace_id = project.workspace_id)
     ORDER BY p.id,
       CASE m.role WHEN 'organization-owner' THEN 1 WHEN 'workspace-admin' THEN 2 ELSE 3 END`,
    [context.organization.id, artifact.projectId],
  );
  return result.rows.map((row) => {
    const self = row.id === context.principal.id;
    const author = row.id === artifact.revision.createdBy.id;
    return {
      ...principal(row.id, row.display_name, row.email),
      role: row.role,
      eligible: !self && !author,
      ineligibleReason: self
        ? "The requester cannot review their own request."
        : author
          ? "The revision author cannot approve their own work."
          : null,
    };
  });
}

export async function createReview(
  context: PrincipalContext,
  input: { artifactId: string; revisionId: string; reviewerIds: string[]; summary: string },
) {
  assertPermission(context, "review:create");
  const reviewerIds = [...new Set(input.reviewerIds)];
  if (!reviewerIds.length) {
    throw new ReviewPolicyError("REVIEWER_REQUIRED", "Assign at least one independent reviewer.");
  }
  if (reviewerIds.length > 20) {
    throw new ReviewPolicyError("TOO_MANY_REVIEWERS", "A review can have at most 20 reviewers.");
  }

  const reviewId = await withTransaction(async (client) => {
    const artifact = await client.query<{
      project_id: string;
      workspace_id: string;
      draft_head_revision_id: string;
      revision_author_id: string;
      artifact_type: "BPMN_PROCESS" | "DMN_DECISION" | "FORM";
      artifact_name: string;
      source: string;
    }>(
      `SELECT a.project_id, p.workspace_id, a.draft_head_revision_id, a.name AS artifact_name,
         ar.created_by AS revision_author_id, a.type AS artifact_type, ar.source
       FROM artifacts a
       JOIN projects p ON p.id = a.project_id AND p.organization_id = a.organization_id
       JOIN artifact_revisions ar
         ON ar.id = a.draft_head_revision_id AND ar.artifact_id = a.id
       WHERE a.organization_id = $1 AND a.id = $2
         AND ($3::uuid IS NULL OR p.workspace_id = $3)
       FOR UPDATE OF a`,
      [context.organization.id, input.artifactId, context.workspaceScopeId],
    );
    const current = artifact.rows[0];
    if (!current) throw new ResourceNotFoundError("artifact");
    if (current.artifact_type === "FORM") {
      throw new ReviewPolicyError("REVIEW_ROOT_NOT_SUPPORTED", "Forms are reviewed with the BPMN process that references them.");
    }
    if (current.draft_head_revision_id !== input.revisionId) {
      throw new ReviewPolicyError(
        "REVISION_NOT_CURRENT",
        "The draft changed before the review was requested. Reload the latest revision.",
      );
    }

    if (reviewerIds.includes(context.principal.id) || reviewerIds.includes(current.revision_author_id)) {
      throw new ReviewPolicyError(
        "SEPARATION_OF_DUTY",
        "The requester and revision author cannot be assigned to approve their own work.",
      );
    }

    const reviewers = await client.query<{ id: string }>(
      `SELECT DISTINCT p.id
       FROM principals p
       JOIN organization_memberships m
         ON m.principal_id = p.id AND m.organization_id = p.organization_id
       WHERE p.organization_id = $1
         AND p.id = ANY($2::uuid[])
         AND m.role IN ('organization-owner', 'workspace-admin', 'reviewer')
         AND (m.workspace_id IS NULL OR m.workspace_id = $3)`,
      [context.organization.id, reviewerIds, current.workspace_id],
    );
    if (reviewers.rows.length !== reviewerIds.length) {
      throw new ReviewPolicyError(
        "REVIEWER_NOT_ELIGIBLE",
        "Every assignee must be an eligible reviewer in this workspace.",
      );
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO reviews
        (organization_id, project_id, artifact_id, revision_id, summary, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.organization.id,
        current.project_id,
        input.artifactId,
        input.revisionId,
        input.summary,
        context.principal.id,
      ],
    );
    const id = created.rows[0].id;
    const formKeys = current.artifact_type === "BPMN_PROCESS"
      ? [...new Set((await listBpmnFormBindings(current.source)).map((binding) => binding.formKey))]
      : [];
    if (formKeys.length) {
      const dependencies = await client.query<{
        artifact_id: string;
        artifact_key: string;
        revision_id: string;
        validation_status: "VALID" | "INVALID";
        source: string;
      }>(
        `SELECT artifact.id AS artifact_id, artifact.key AS artifact_key,
           revision.id AS revision_id, revision.validation_status, revision.source
         FROM artifacts artifact
         JOIN artifact_revisions revision ON revision.id = artifact.draft_head_revision_id
         WHERE artifact.organization_id = $1 AND artifact.project_id = $2
           AND artifact.type = 'FORM' AND artifact.key = ANY($3::text[])
         FOR SHARE OF artifact, revision`,
        [context.organization.id, current.project_id, formKeys],
      );
      if (dependencies.rows.length !== formKeys.length) {
        const found = new Set(dependencies.rows.map((dependency) => dependency.artifact_key));
        const missing = formKeys.filter((key) => !found.has(key));
        throw new ReviewPolicyError("FORM_REFERENCE_NOT_FOUND", `Referenced form${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}.`);
      }
      const invalid = dependencies.rows.filter((dependency) => dependency.validation_status !== "VALID");
      if (invalid.length) {
        throw new ReviewPolicyError("FORM_REFERENCE_INVALID", `Referenced form${invalid.length === 1 ? " is" : "s are"} invalid: ${invalid.map((dependency) => dependency.artifact_key).join(", ")}.`);
      }
      const bindings = await listBpmnFormBindings(current.source);
      for (const dependency of dependencies.rows) {
        const fields = new Set(listFormFieldKeys(parseFormSource(dependency.source)));
        const referencedFields = bindings
          .filter((binding) => binding.formKey === dependency.artifact_key)
          .flatMap((binding) => [
            ...Object.keys(binding.inputMapping),
            ...Object.values(binding.outputMapping),
          ]);
        const missingFields = [...new Set(referencedFields.filter((field) => !fields.has(field)))];
        if (missingFields.length) {
          throw new ReviewPolicyError(
            "FORM_MAPPING_FIELD_NOT_FOUND",
            `Form ${dependency.artifact_key} does not define mapped field${missingFields.length === 1 ? "" : "s"}: ${missingFields.join(", ")}.`,
          );
        }
      }
      for (const dependency of dependencies.rows) {
        await client.query(
          `INSERT INTO review_artifact_dependencies
            (review_id, organization_id, project_id, artifact_id, revision_id, artifact_key, artifact_type)
           VALUES ($1, $2, $3, $4, $5, $6, 'FORM')`,
          [id, context.organization.id, current.project_id, dependency.artifact_id, dependency.revision_id, dependency.artifact_key],
        );
      }
    }
    if (current.artifact_type === "BPMN_PROCESS") {
      const bindings = await listBpmnDecisionBindings(current.source);
      const decisionKeys = [...new Set(bindings.map((binding) => binding.decisionKey))];
      if (decisionKeys.length) {
        const dependencies = await client.query<{
          artifact_id: string;
          artifact_key: string;
          revision_id: string;
          validation_status: "VALID" | "INVALID";
          source: string;
        }>(
          `SELECT artifact.id AS artifact_id, artifact.key AS artifact_key,
             revision.id AS revision_id, revision.validation_status, revision.source
           FROM artifacts artifact
           JOIN artifact_revisions revision ON revision.id = artifact.draft_head_revision_id
           WHERE artifact.organization_id = $1 AND artifact.project_id = $2
             AND artifact.type = 'DMN_DECISION' AND artifact.key = ANY($3::text[])
           FOR SHARE OF artifact, revision`,
          [context.organization.id, current.project_id, decisionKeys],
        );
        if (dependencies.rows.length !== decisionKeys.length) {
          const found = new Set(dependencies.rows.map((dependency) => dependency.artifact_key));
          const missing = decisionKeys.filter((key) => !found.has(key));
          throw new ReviewPolicyError(
            "DMN_REFERENCE_NOT_FOUND",
            `Referenced decision${missing.length === 1 ? "" : "s"} not found: ${missing.join(", ")}.`,
          );
        }
        const invalid = dependencies.rows.filter((dependency) => dependency.validation_status !== "VALID");
        if (invalid.length) {
          throw new ReviewPolicyError(
            "DMN_REFERENCE_INVALID",
            `Referenced decision${invalid.length === 1 ? " is" : "s are"} invalid: ${invalid.map((entry) => entry.artifact_key).join(", ")}.`,
          );
        }
        for (const dependency of dependencies.rows) {
          const decision = await parseDmnDecision(dependency.source);
          const inputs = new Set(decision.inputs.map((entry) => entry.name));
          const outputs = new Set(decision.outputs.map((entry) => entry.name));
          for (const binding of bindings.filter((entry) => entry.decisionKey === dependency.artifact_key)) {
            const missingInputs = [...inputs].filter((name) => !Object.hasOwn(binding.inputMapping, name));
            const unknownInputs = Object.keys(binding.inputMapping).filter((name) => !inputs.has(name));
            const unknownOutputs = Object.values(binding.outputMapping).filter((name) => !outputs.has(name));
            if (missingInputs.length || unknownInputs.length || unknownOutputs.length) {
              throw new ReviewPolicyError(
                "DMN_MAPPING_FIELD_NOT_FOUND",
                `Decision ${dependency.artifact_key} mapping is incomplete or references unknown fields` +
                  `${missingInputs.length ? `; missing inputs: ${missingInputs.join(", ")}` : ""}` +
                  `${unknownInputs.length ? `; unknown inputs: ${unknownInputs.join(", ")}` : ""}` +
                  `${unknownOutputs.length ? `; unknown outputs: ${unknownOutputs.join(", ")}` : ""}.`,
              );
            }
          }
          await client.query(
            `INSERT INTO review_artifact_dependencies
              (review_id, organization_id, project_id, artifact_id, revision_id, artifact_key, artifact_type)
             VALUES ($1, $2, $3, $4, $5, $6, 'DMN_DECISION')`,
            [id, context.organization.id, current.project_id, dependency.artifact_id, dependency.revision_id, dependency.artifact_key],
          );
        }
      }
    }
    for (const reviewerId of reviewerIds) {
      await client.query(
        `INSERT INTO review_assignments
          (organization_id, review_id, principal_id, assigned_by)
         VALUES ($1, $2, $3, $4)`,
        [context.organization.id, id, reviewerId, context.principal.id],
      );
      await insertNotification(client, {
        organizationId: context.organization.id,
        recipientId: reviewerId,
        actorId: context.principal.id,
        kind: "REVIEW_REQUESTED",
        title: `Review requested · ${current.artifact_name}`,
        body: input.summary.trim() || "A revision is ready for your decision.",
        href: `/reviews/${id}`,
        resourceType: "review",
        resourceId: id,
        dedupeKey: `review:${id}:requested:${reviewerId}`,
      });
    }
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      reviewId: id,
      action: "review.requested",
      details: {
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        reviewerIds,
      },
    });
    return id;
  }).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new ReviewPolicyError("REVIEW_ALREADY_EXISTS", "This revision already has a review.");
    }
    throw error;
  });
  return getReview(context, reviewId);
}

export async function addReviewComment(
  context: PrincipalContext,
  reviewId: string,
  input: { elementId: string; body: string; mentionedPrincipalIds?: string[] },
) {
  assertPermission(context, "review:comment");
  const review = await getReview(context, reviewId);
  if (review.status !== "OPEN") throw new ReviewStateConflictError(review.status);
  const element = review.elements.find((candidate) => candidate.id === input.elementId);
  if (!element) {
    throw new ReviewPolicyError(
      "ELEMENT_NOT_IN_REVISION",
      "The comment anchor does not exist in the pinned BPMN revision.",
    );
  }
  const mentionedPrincipalIds = [...new Set(input.mentionedPrincipalIds ?? [])];
  const allowedMentions = new Set([
    review.requestedBy.id,
    ...review.assignments.map((assignment) => assignment.reviewer.id),
  ]);
  if (mentionedPrincipalIds.some((id) => !allowedMentions.has(id))) {
    throw new ReviewPolicyError(
      "MENTION_NOT_IN_REVIEW",
      "Comments may mention the requester or an assigned reviewer.",
    );
  }
  await withTransaction(async (client) => {
    const locked = await client.query<{ status: ReviewStatus }>(
      "SELECT status FROM reviews WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [reviewId, context.organization.id],
    );
    if (!locked.rows[0]) throw new ResourceNotFoundError("review");
    if (locked.rows[0].status !== "OPEN") throw new ReviewStateConflictError(locked.rows[0].status);
    const comment = await client.query<{ id: string }>(
      `INSERT INTO review_comments
        (organization_id, review_id, element_id, element_name, body, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        context.organization.id,
        reviewId,
        element.id,
        element.name,
        input.body,
        context.principal.id,
      ],
    );
    for (const principalId of mentionedPrincipalIds) {
      await client.query(
        `INSERT INTO review_comment_mentions
          (review_id, comment_id, organization_id, principal_id)
         VALUES ($1, $2, $3, $4)`,
        [reviewId, comment.rows[0].id, context.organization.id, principalId],
      );
      await insertNotification(client, {
        organizationId: context.organization.id,
        recipientId: principalId,
        actorId: context.principal.id,
        kind: "REVIEW_MENTIONED",
        title: `Mentioned in review · ${review.artifact.name}`,
        body: input.body,
        href: `/reviews/${reviewId}`,
        resourceType: "review-comment",
        resourceId: comment.rows[0].id,
        dedupeKey: `review-comment:${comment.rows[0].id}:mention:${principalId}`,
      });
    }
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      reviewId,
      action: "review.comment-added",
      details: {
        commentId: comment.rows[0].id,
        elementId: element.id,
        elementName: element.name,
        mentionedPrincipalIds,
      },
    });
  });
  return getReview(context, reviewId);
}

export async function resolveReviewComment(
  context: PrincipalContext,
  reviewId: string,
  commentId: string,
) {
  assertPermission(context, "review:comment");
  await getReview(context, reviewId);
  await withTransaction(async (client) => {
    const locked = await client.query<{ status: ReviewStatus }>(
      "SELECT status FROM reviews WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [reviewId, context.organization.id],
    );
    if (!locked.rows[0]) throw new ResourceNotFoundError("review");
    if (locked.rows[0].status !== "OPEN") throw new ReviewStateConflictError(locked.rows[0].status);
    const result = await client.query(
      `UPDATE review_comments
       SET resolved_at = now(), resolved_by = $1
       WHERE id = $2 AND review_id = $3 AND organization_id = $4
       RETURNING id`,
      [context.principal.id, commentId, reviewId, context.organization.id],
    );
    if (!result.rowCount) throw new ResourceNotFoundError("review comment");
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      reviewId,
      action: "review.comment-resolved",
      details: { commentId },
    });
  });
  return getReview(context, reviewId);
}

export async function decideReview(
  context: PrincipalContext,
  reviewId: string,
  input: { outcome: ReviewOutcome; note?: string },
) {
  assertPermission(context, "review:decide");
  await getReview(context, reviewId);
  await withTransaction(async (client) => {
    const locked = await client.query<{
      status: ReviewStatus;
      requested_by: string;
      revision_author_id: string;
      validation_status: "VALID" | "INVALID";
    }>(
      `SELECT rv.status, rv.requested_by, ar.created_by AS revision_author_id,
         ar.validation_status
       FROM reviews rv
       JOIN artifact_revisions ar ON ar.id = rv.revision_id AND ar.artifact_id = rv.artifact_id
       WHERE rv.id = $1 AND rv.organization_id = $2
       FOR UPDATE OF rv`,
      [reviewId, context.organization.id],
    );
    const review = locked.rows[0];
    if (!review) throw new ResourceNotFoundError("review");
    if (review.status !== "OPEN") throw new ReviewStateConflictError(review.status);
    const assignment = await client.query(
      `SELECT 1 FROM review_assignments
       WHERE review_id = $1 AND principal_id = $2`,
      [reviewId, context.principal.id],
    );
    if (!assignment.rowCount) {
      throw new ReviewPolicyError("REVIEWER_NOT_ASSIGNED", "Only an assigned reviewer can decide this review.");
    }
    if (
      review.requested_by === context.principal.id ||
      review.revision_author_id === context.principal.id
    ) {
      throw new ReviewPolicyError(
        "SEPARATION_OF_DUTY",
        "The requester and revision author cannot approve their own work.",
      );
    }
    if (input.outcome === "APPROVED") {
      if (review.validation_status !== "VALID") {
        throw new ReviewPolicyError("REVISION_INVALID", "An invalid revision cannot be approved.");
      }
      const unresolved = await client.query(
        "SELECT 1 FROM review_comments WHERE review_id = $1 AND resolved_at IS NULL LIMIT 1",
        [reviewId],
      );
      if (unresolved.rowCount) {
        throw new ReviewPolicyError(
          "OPEN_COMMENTS",
          "Resolve open comments before approving this revision.",
        );
      }
    } else if (!input.note?.trim()) {
      throw new ReviewPolicyError(
        "DECISION_NOTE_REQUIRED",
        "A change request must explain what needs attention.",
      );
    }

    await client.query(
      `INSERT INTO review_decisions
        (organization_id, review_id, outcome, note, decided_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [context.organization.id, reviewId, input.outcome, input.note?.trim() || null, context.principal.id],
    );
    await client.query(
      `UPDATE reviews SET status = $1, decided_at = now() WHERE id = $2`,
      [input.outcome, reviewId],
    );
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      reviewId,
      action: input.outcome === "APPROVED" ? "review.approved" : "review.changes-requested",
      details: input.note?.trim() ? { note: input.note.trim() } : {},
    });
    await insertNotification(client, {
      organizationId: context.organization.id,
      recipientId: review.requested_by,
      actorId: context.principal.id,
      kind: "REVIEW_DECIDED",
      title: input.outcome === "APPROVED" ? "Revision approved" : "Changes requested",
      body: input.note?.trim() || "Your review has a decision.",
      href: `/reviews/${reviewId}`,
      resourceType: "review",
      resourceId: reviewId,
      dedupeKey: `review:${reviewId}:decision`,
    });
  });
  return getReview(context, reviewId);
}

export async function cancelReview(context: PrincipalContext, reviewId: string) {
  assertPermission(context, "review:cancel");
  const current = await getReview(context, reviewId);
  if (
    current.requestedBy.id !== context.principal.id &&
    context.role !== "organization-owner" &&
    context.role !== "workspace-admin"
  ) {
    throw new ReviewPolicyError("CANCELLATION_NOT_ALLOWED", "Only the requester or an administrator can cancel this review.");
  }
  await withTransaction(async (client) => {
    const result = await client.query<{ status: ReviewStatus }>(
      `SELECT status FROM reviews
       WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [reviewId, context.organization.id],
    );
    if (!result.rows[0]) throw new ResourceNotFoundError("review");
    if (result.rows[0].status !== "OPEN") throw new ReviewStateConflictError(result.rows[0].status);
    await client.query(
      "UPDATE reviews SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [reviewId],
    );
    await insertAuditAndEvent(client, {
      organizationId: context.organization.id,
      actorId: context.principal.id,
      reviewId,
      action: "review.cancelled",
      details: {},
    });
  });
  return getReview(context, reviewId);
}
