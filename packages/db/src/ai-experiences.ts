import {
  assertPermission,
  assertProjectAccess,
} from "./authorization";
import { getArtifact } from "./artifacts";
import { ResourceNotFoundError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type {
  AiExperience,
  AiExperienceArtifactRole,
  AiExperienceEvent,
  PrincipalContext,
} from "./types";

type ExperienceRow = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  description: string;
  status: "ACTIVE" | "ARCHIVED";
  transcript: unknown[];
  created_by: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
};

type EventRow = {
  id: string;
  kind: string;
  label: string;
  detail: Record<string, unknown>;
  created_at: Date;
};

const EXPERIENCE_SELECT = `
  SELECT e.id, e.organization_id, e.project_id, e.title, e.description, e.status,
         e.transcript, e.created_by, p.display_name AS created_by_name,
         e.created_at, e.updated_at
  FROM ai_experiences e
  JOIN principals p ON p.id = e.created_by
`;

function mapEvent(row: EventRow): AiExperienceEvent {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  };
}

async function loadExperienceRow(context: PrincipalContext, experienceId: string) {
  const result = await getPool().query<ExperienceRow>(
    `${EXPERIENCE_SELECT} WHERE e.organization_id = $1 AND e.id = $2`,
    [context.organization.id, experienceId],
  );
  const row = result.rows[0];
  if (!row) throw new ResourceNotFoundError("AI experience");
  await assertProjectAccess(context, row.project_id);
  return row;
}

async function hydrateExperience(context: PrincipalContext, row: ExperienceRow): Promise<AiExperience> {
  const [linkResult, eventResult] = await Promise.all([
    getPool().query<{ artifact_id: string; role: AiExperienceArtifactRole }>(
      `SELECT artifact_id, role
       FROM ai_experience_artifacts
       WHERE organization_id = $1 AND experience_id = $2
       ORDER BY CASE role WHEN 'MAIN' THEN 0 WHEN 'FORM' THEN 1 ELSE 2 END, created_at ASC`,
      [context.organization.id, row.id],
    ),
    getPool().query<EventRow>(
      `SELECT id, kind, label, detail, created_at
       FROM ai_experience_events
       WHERE organization_id = $1 AND experience_id = $2
       ORDER BY created_at ASC, id ASC`,
      [context.organization.id, row.id],
    ),
  ]);
  const artifacts = await Promise.all(linkResult.rows.map(async (link) => ({
    role: link.role,
    artifact: await getArtifact(context.organization.id, link.artifact_id),
  })));
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    transcript: row.transcript,
    artifacts,
    events: eventResult.rows.map(mapEvent),
    createdBy: { id: row.created_by, displayName: row.created_by_name },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createAiExperience(
  context: PrincipalContext,
  input: { projectId: string; title: string; description: string },
) {
  assertPermission(context, "artifact:create");
  await assertProjectAccess(context, input.projectId);
  const id = await withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ai_experiences
        (organization_id, project_id, title, description, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [context.organization.id, input.projectId, input.title, input.description, context.principal.id],
    );
    const experienceId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO ai_experience_events
        (experience_id, organization_id, kind, label, detail)
       VALUES ($1, $2, 'SESSION_CREATED', 'Experience started', $3::jsonb)`,
      [experienceId, context.organization.id, JSON.stringify({ projectId: input.projectId })],
    );
    await client.query(
      `INSERT INTO audit_records
        (organization_id, actor_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'ai-experience.created', 'ai-experience', $3, $4::jsonb)`,
      [context.organization.id, context.principal.id, experienceId, JSON.stringify({ projectId: input.projectId })],
    );
    return experienceId;
  });
  return getAiExperience(context, id);
}

export async function getAiExperience(context: PrincipalContext, experienceId: string) {
  assertPermission(context, "artifact:read");
  return hydrateExperience(context, await loadExperienceRow(context, experienceId));
}

export async function updateAiExperienceTranscript(
  context: PrincipalContext,
  experienceId: string,
  transcript: unknown[],
) {
  assertPermission(context, "artifact:create");
  await loadExperienceRow(context, experienceId);
  await getPool().query(
    `UPDATE ai_experiences SET transcript = $1::jsonb, updated_at = now()
     WHERE organization_id = $2 AND id = $3`,
    [JSON.stringify(transcript), context.organization.id, experienceId],
  );
  return { updated: true as const };
}

export async function findAiExperienceArtifact(
  context: PrincipalContext,
  experienceId: string,
  role: AiExperienceArtifactRole,
  key?: string,
) {
  const experience = await loadExperienceRow(context, experienceId);
  const result = await getPool().query<{ artifact_id: string }>(
    `SELECT l.artifact_id
     FROM ai_experience_artifacts l
     JOIN artifacts a ON a.id = l.artifact_id
     WHERE l.organization_id = $1 AND l.experience_id = $2 AND l.role = $3
       AND ($4::text IS NULL OR a.key = $4)
     ORDER BY l.created_at ASC LIMIT 1`,
    [context.organization.id, experience.id, role, key ?? null],
  );
  return result.rows[0]
    ? getArtifact(context.organization.id, result.rows[0].artifact_id)
    : null;
}

export async function linkAiExperienceArtifact(
  context: PrincipalContext,
  experienceId: string,
  artifactId: string,
  role: AiExperienceArtifactRole,
) {
  assertPermission(context, "artifact:create");
  const [experience, artifact] = await Promise.all([
    loadExperienceRow(context, experienceId),
    getArtifact(context.organization.id, artifactId),
  ]);
  if (artifact.projectId !== experience.project_id) throw new ResourceNotFoundError("artifact");
  await getPool().query(
    `INSERT INTO ai_experience_artifacts (experience_id, organization_id, artifact_id, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (experience_id, artifact_id) DO UPDATE SET role = EXCLUDED.role`,
    [experienceId, context.organization.id, artifactId, role],
  );
}

export async function recordAiExperienceEvent(
  context: PrincipalContext,
  experienceId: string,
  input: { kind: string; label: string; detail?: Record<string, unknown> },
) {
  await loadExperienceRow(context, experienceId);
  await getPool().query(
    `INSERT INTO ai_experience_events
      (experience_id, organization_id, kind, label, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [experienceId, context.organization.id, input.kind, input.label, JSON.stringify(input.detail ?? {})],
  );
}

export async function recordAiChoiceResponse(
  context: PrincipalContext,
  experienceId: string,
  input: {
    toolCallId: string;
    question: string;
    selection: "SINGLE" | "MULTIPLE";
    options: Array<{ id: string; label: string; description?: string }>;
    answer: string[];
  },
) {
  assertPermission(context, "artifact:create");
  await loadExperienceRow(context, experienceId);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ai_choice_responses
        (experience_id, organization_id, tool_call_id, question, selection, options, answer, answered_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
       ON CONFLICT (experience_id, tool_call_id) DO NOTHING`,
      [experienceId, context.organization.id, input.toolCallId, input.question, input.selection,
        JSON.stringify(input.options), JSON.stringify(input.answer), context.principal.id],
    );
    await client.query(
      `INSERT INTO ai_experience_events
        (experience_id, organization_id, kind, label, detail)
       VALUES ($1, $2, 'CHOICE_ANSWERED', 'Direction received', $3::jsonb)`,
      [experienceId, context.organization.id, JSON.stringify({
        toolCallId: input.toolCallId,
        selection: input.selection,
        answer: input.answer,
      })],
    );
  });
}
