import { createHash, randomUUID } from "node:crypto";

import { evaluateDmnDecision, type RuntimeJsonObject } from "@wanaflow/modeling";
import type { PoolClient } from "pg";

import { assertPermission } from "./authorization";
import { ResourceNotFoundError, RuntimePolicyError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type { DecisionEvaluation, PrincipalContext } from "./types";

type EvaluationRow = {
  id: string;
  deployment_id: string;
  environment_id: string;
  decision_artifact_version_id: string;
  decision_key: string;
  decision_id: string;
  decision_name: string;
  hit_policy: "UNIQUE" | "FIRST";
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  matched_rule_ids: string[];
  outcome: "MATCHED" | "NO_MATCH";
  request_sha256: string;
  source_instance_id: string | null;
  source_element_id: string | null;
  source_element_name: string | null;
  checkpoint_revision: number | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  created_at: Date;
};

const EVALUATION_SELECT = `
  SELECT evaluation.id, evaluation.deployment_id, evaluation.environment_id,
    evaluation.decision_artifact_version_id, evaluation.decision_key,
    evaluation.decision_id, evaluation.decision_name, evaluation.hit_policy,
    evaluation.input, evaluation.output, evaluation.matched_rule_ids, evaluation.outcome,
    evaluation.request_sha256,
    evaluation.source_instance_id, evaluation.source_element_id, evaluation.source_element_name,
    evaluation.checkpoint_revision,
    actor.id AS created_by_id, actor.display_name AS created_by_name, actor.email AS created_by_email,
    evaluation.created_at
  FROM decision_evaluations evaluation
  LEFT JOIN principals actor
    ON actor.id = evaluation.created_by AND actor.organization_id = evaluation.organization_id
  JOIN projects project
    ON project.id = evaluation.project_id AND project.organization_id = evaluation.organization_id
`;

function mapEvaluation(row: EvaluationRow): DecisionEvaluation {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    environmentId: row.environment_id,
    decisionArtifactVersionId: row.decision_artifact_version_id,
    decisionKey: row.decision_key,
    decision: { id: row.decision_id, name: row.decision_name, hitPolicy: row.hit_policy },
    input: row.input,
    output: row.output,
    matchedRuleIds: row.matched_rule_ids,
    outcome: row.outcome,
    source: row.source_instance_id && row.source_element_id && row.source_element_name && row.checkpoint_revision
      ? {
          instanceId: row.source_instance_id,
          elementId: row.source_element_id,
          elementName: row.source_element_name,
          checkpointRevision: row.checkpoint_revision,
        }
      : null,
    createdBy: row.created_by_id && row.created_by_name && row.created_by_email
      ? { id: row.created_by_id, displayName: row.created_by_name, email: row.created_by_email }
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestSha256(deploymentId: string, decisionKey: string, input: Record<string, unknown>) {
  return createHash("sha256").update(canonical({ deploymentId, decisionKey, input }), "utf8").digest("hex");
}

async function loadByIdempotencyKey(context: PrincipalContext, idempotencyKey: string) {
  const result = await getPool().query<EvaluationRow & { request_sha256: string }>(
    `${EVALUATION_SELECT}
     WHERE evaluation.organization_id = $1 AND evaluation.idempotency_key = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [context.organization.id, idempotencyKey, context.workspaceScopeId],
  );
  return result.rows[0] ?? null;
}

async function insertAuditAndEvent(
  client: PoolClient,
  context: PrincipalContext,
  evaluationId: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_records
      (organization_id, actor_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, 'decision.evaluated', 'decision-evaluation', $3, $4::jsonb)`,
    [context.organization.id, context.principal.id, evaluationId, JSON.stringify(details)],
  );
  await client.query(
    `INSERT INTO outbox_events
      (organization_id, type, aggregate_type, aggregate_id, payload)
     VALUES ($1, 'decision.evaluated', 'decision-evaluation', $2, $3::jsonb)`,
    [context.organization.id, evaluationId, JSON.stringify({ evaluationId, ...details })],
  );
}

export async function evaluateDecision(
  context: PrincipalContext,
  input: {
    deploymentId: string;
    decisionKey: string;
    input: Record<string, unknown>;
    idempotencyKey?: string | null;
  },
): Promise<DecisionEvaluation> {
  assertPermission(context, "decision:evaluate");
  const key = input.idempotencyKey?.trim() || null;
  if (key && key.length > 255) {
    throw new RuntimePolicyError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain at most 255 characters.");
  }
  const requestHash = requestSha256(input.deploymentId, input.decisionKey, input.input);
  if (key) {
    const existing = await loadByIdempotencyKey(context, key);
    if (existing) {
      if (existing.request_sha256 !== requestHash) {
        throw new RuntimePolicyError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key belongs to a different decision request.");
      }
      return mapEvaluation(existing);
    }
  }

  const pinned = await getPool().query<{
    project_id: string;
    environment_id: string;
    publication_id: string;
    artifact_version_id: string;
    source: string;
  }>(
    `SELECT deployment.project_id, deployment.environment_id, deployment.publication_id,
       version.id AS artifact_version_id, revision.source
     FROM deployments deployment
     JOIN projects project
       ON project.id = deployment.project_id AND project.organization_id = deployment.organization_id
     JOIN artifact_versions version
       ON version.publication_id = deployment.publication_id AND version.organization_id = deployment.organization_id
     JOIN artifacts artifact
       ON artifact.id = version.artifact_id AND artifact.organization_id = deployment.organization_id
     JOIN artifact_revisions revision
       ON revision.id = version.revision_id AND revision.artifact_id = version.artifact_id
     WHERE deployment.id = $1 AND deployment.organization_id = $2
       AND artifact.type = 'DMN_DECISION' AND artifact.key = $3
       AND ($4::uuid IS NULL OR project.workspace_id = $4)`,
    [input.deploymentId, context.organization.id, input.decisionKey, context.workspaceScopeId],
  );
  const subject = pinned.rows[0];
  if (!subject) throw new ResourceNotFoundError("deployed decision");
  const result = await evaluateDmnDecision(subject.source, input.input as RuntimeJsonObject);
  const id = randomUUID();
  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO decision_evaluations
          (id, organization_id, project_id, environment_id, deployment_id, publication_id,
           decision_artifact_version_id, decision_key, decision_id, decision_name, hit_policy,
           input, output, matched_rule_ids, outcome, request_sha256, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12::jsonb, $13::jsonb, $14::text[], $15, $16, $17, $18)`,
        [
          id,
          context.organization.id,
          subject.project_id,
          subject.environment_id,
          input.deploymentId,
          subject.publication_id,
          subject.artifact_version_id,
          input.decisionKey,
          result.decisionId,
          result.decisionName,
          result.hitPolicy,
          JSON.stringify(input.input),
          result.output === null ? null : JSON.stringify(result.output),
          result.matchedRuleIds,
          result.output === null ? "NO_MATCH" : "MATCHED",
          requestHash,
          key,
          context.principal.id,
        ],
      );
      await insertAuditAndEvent(client, context, id, {
        deploymentId: input.deploymentId,
        decisionKey: input.decisionKey,
        outcome: result.output === null ? "NO_MATCH" : "MATCHED",
        matchedRuleIds: result.matchedRuleIds,
      });
    });
  } catch (error) {
    if (key && typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const existing = await loadByIdempotencyKey(context, key);
      if (existing && existing.request_sha256 === requestHash) return mapEvaluation(existing);
      throw new RuntimePolicyError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key belongs to a different decision request.");
    }
    throw error;
  }
  return getDecisionEvaluation(context, id);
}

export async function getDecisionEvaluation(context: PrincipalContext, evaluationId: string) {
  assertPermission(context, "decision:read");
  const result = await getPool().query<EvaluationRow>(
    `${EVALUATION_SELECT}
     WHERE evaluation.id = $1 AND evaluation.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [evaluationId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("decision evaluation");
  return mapEvaluation(result.rows[0]);
}

export async function listDecisionEvaluations(
  context: PrincipalContext,
  input: { deploymentId?: string; instanceId?: string; limit?: number } = {},
) {
  assertPermission(context, "decision:read");
  const filters = ["evaluation.organization_id = $1", "($2::uuid IS NULL OR project.workspace_id = $2)"];
  const values: Array<string | number | null> = [context.organization.id, context.workspaceScopeId];
  if (input.deploymentId) {
    values.push(input.deploymentId);
    filters.push(`evaluation.deployment_id = $${values.length}`);
  }
  if (input.instanceId) {
    values.push(input.instanceId);
    filters.push(`evaluation.source_instance_id = $${values.length}`);
  }
  values.push(Math.min(Math.max(input.limit ?? 100, 1), 200));
  const result = await getPool().query<EvaluationRow>(
    `${EVALUATION_SELECT}
     WHERE ${filters.join(" AND ")}
     ORDER BY evaluation.created_at DESC, evaluation.id DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(mapEvaluation);
}
