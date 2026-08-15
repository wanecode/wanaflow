import { listBpmnDecisionBindings } from "@wanaflow/modeling";
import { BpmnEngineAdapter, type RuntimeEnvelope, type RuntimeVariables } from "@wanaflow/runtime";

import { assertPermission, assertProjectAccess } from "./authorization";
import { ResourceNotFoundError, RuntimePolicyError } from "./errors";
import { getPool } from "./pool";
import type { DraftSimulationResult, PrincipalContext } from "./types";

function runtimeVariables(value: Record<string, unknown>): RuntimeVariables {
  return structuredClone(value) as RuntimeVariables;
}

export async function simulateArtifactDraft(
  context: PrincipalContext,
  input: {
    artifactId: string;
    revisionId: string;
    variables: Record<string, unknown>;
    envelope?: unknown;
    signal?: { executionId: string; output: Record<string, unknown> };
  },
): Promise<DraftSimulationResult> {
  assertPermission(context, "artifact:read");
  const artifactResult = await getPool().query<{
    project_id: string;
    type: "BPMN_PROCESS" | "DMN_DECISION" | "FORM";
    draft_head_revision_id: string;
    source: string;
    content_sha256: string;
  }>(
    `SELECT artifact.project_id, artifact.type, artifact.draft_head_revision_id,
       revision.source, revision.content_sha256
     FROM artifacts artifact
     JOIN artifact_revisions revision
       ON revision.id = artifact.draft_head_revision_id AND revision.artifact_id = artifact.id
     WHERE artifact.id = $1 AND artifact.organization_id = $2`,
    [input.artifactId, context.organization.id],
  );
  const artifact = artifactResult.rows[0];
  if (!artifact) throw new ResourceNotFoundError("artifact");
  await assertProjectAccess(context, artifact.project_id);
  if (artifact.type !== "BPMN_PROCESS") {
    throw new RuntimePolicyError("SIMULATION_REQUIRES_PROCESS", "Draft simulation starts from a BPMN process.");
  }
  if (artifact.draft_head_revision_id !== input.revisionId) {
    throw new RuntimePolicyError(
      "SIMULATION_REVISION_CHANGED",
      "The draft changed before this simulation step. Restart from the latest saved revision.",
    );
  }

  const bindings = await listBpmnDecisionBindings(artifact.source);
  const decisionKeys = [...new Set(bindings.map((binding) => binding.decisionKey))];
  const decisionResult = decisionKeys.length
    ? await getPool().query<{
        key: string;
        revision_id: string;
        source: string;
        content_sha256: string;
      }>(
        `SELECT artifact.key, revision.id AS revision_id, revision.source, revision.content_sha256
         FROM artifacts artifact
         JOIN artifact_revisions revision
           ON revision.id = artifact.draft_head_revision_id AND revision.artifact_id = artifact.id
         WHERE artifact.organization_id = $1 AND artifact.project_id = $2
           AND artifact.type = 'DMN_DECISION' AND artifact.key = ANY($3::text[])`,
        [context.organization.id, artifact.project_id, decisionKeys],
      )
    : { rows: [] };
  if (decisionResult.rows.length !== decisionKeys.length) {
    throw new RuntimePolicyError(
      "SIMULATION_DECISION_MISSING",
      "Save every decision referenced by this process before simulating it.",
    );
  }

  const adapter = new BpmnEngineAdapter();
  const common = {
    instanceId: `simulation-${input.revisionId}`,
    deploymentHash: artifact.content_sha256,
    source: artifact.source,
    variables: runtimeVariables(input.variables),
    decisions: decisionResult.rows.map((decision) => ({
      key: decision.key,
      artifactVersionId: decision.revision_id,
      contentSha256: decision.content_sha256,
      source: decision.source,
    })),
  };
  const result = input.envelope && input.signal
    ? await adapter.resume({
        ...common,
        envelope: input.envelope as RuntimeEnvelope,
        signal: {
          executionId: input.signal.executionId,
          output: runtimeVariables(input.signal.output),
        },
      })
    : await adapter.start(common);

  return {
    status: result.status,
    revisionId: input.revisionId,
    sourceSha256: artifact.content_sha256,
    envelope: result.envelope,
    waits: result.waits,
    events: result.events,
    decisionEvaluations: result.decisionEvaluations,
    variables: result.variables,
  };
}
