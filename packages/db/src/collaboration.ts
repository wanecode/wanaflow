import { listBpmnElements, listDmnElements } from "@wanaflow/modeling";

import { assertPermission, assertProjectAccess } from "./authorization";
import { ResourceNotFoundError } from "./errors";
import { getPool } from "./pool";
import type { ArtifactEditorPresence, ArtifactType, PrincipalContext } from "./types";

type PresenceRow = {
  id: string;
  artifact_id: string;
  revision_id: string;
  current_revision_id: string;
  client_id: string;
  principal_id: string;
  principal_name: string;
  principal_email: string;
  selected_element_id: string | null;
  selected_element_name: string | null;
  selected_element_type: string | null;
  cursor_x: number | null;
  cursor_y: number | null;
  state: "ACTIVE" | "IDLE";
  last_seen_at: Date;
};

function mapPresence(row: PresenceRow): ArtifactEditorPresence {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    revisionId: row.revision_id,
    currentRevisionId: row.current_revision_id,
    clientId: row.client_id,
    principal: {
      id: row.principal_id,
      displayName: row.principal_name,
      email: row.principal_email,
    },
    selectedElement: row.selected_element_id
      ? {
          id: row.selected_element_id,
          name: row.selected_element_name!,
          type: row.selected_element_type!,
        }
      : null,
    cursor: row.cursor_x !== null && row.cursor_y !== null
      ? { x: row.cursor_x, y: row.cursor_y }
      : null,
    state: row.state,
    isCurrentRevision: row.revision_id === row.current_revision_id,
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

async function assertArtifactAccess(context: PrincipalContext, artifactId: string) {
  const result = await getPool().query<{
    project_id: string;
    type: ArtifactType;
    draft_head_revision_id: string;
  }>(
    `SELECT project_id, type, draft_head_revision_id
     FROM artifacts
     WHERE id = $1 AND organization_id = $2`,
    [artifactId, context.organization.id],
  );
  const artifact = result.rows[0];
  if (!artifact) throw new ResourceNotFoundError("artifact");
  await assertProjectAccess(context, artifact.project_id);
  return artifact;
}

export async function listArtifactPresence(
  context: PrincipalContext,
  artifactId: string,
): Promise<ArtifactEditorPresence[]> {
  assertPermission(context, "artifact:read");
  await assertArtifactAccess(context, artifactId);
  await getPool().query(
    `DELETE FROM artifact_editor_presence
     WHERE artifact_id = $1 AND last_seen_at < now() - interval '75 seconds'`,
    [artifactId],
  );
  const result = await getPool().query<PresenceRow>(
    `SELECT presence.id, presence.artifact_id, presence.revision_id,
       artifact.draft_head_revision_id AS current_revision_id,
       presence.client_id, principal.id AS principal_id,
       principal.display_name AS principal_name, principal.email AS principal_email,
       presence.selected_element_id, presence.selected_element_name,
       presence.selected_element_type, presence.cursor_x, presence.cursor_y,
       presence.state, presence.last_seen_at
     FROM artifact_editor_presence presence
     JOIN artifacts artifact
       ON artifact.id = presence.artifact_id AND artifact.organization_id = presence.organization_id
     JOIN principals principal
       ON principal.id = presence.principal_id AND principal.organization_id = presence.organization_id
     WHERE presence.artifact_id = $1 AND presence.organization_id = $2
       AND presence.last_seen_at >= now() - interval '45 seconds'
     ORDER BY presence.state ASC, presence.last_seen_at DESC`,
    [artifactId, context.organization.id],
  );
  return result.rows.map(mapPresence);
}

export async function touchArtifactPresence(
  context: PrincipalContext,
  input: {
    artifactId: string;
    revisionId: string;
    clientId: string;
    selectedElementId?: string | null;
    cursor?: { x: number; y: number } | null;
    state?: "ACTIVE" | "IDLE";
  },
): Promise<ArtifactEditorPresence[]> {
  assertPermission(context, "artifact:update");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(input.clientId)) {
    throw new TypeError("The editor client identifier is invalid.");
  }
  const artifact = await assertArtifactAccess(context, input.artifactId);
  const revision = await getPool().query<{ source: string }>(
    `SELECT source FROM artifact_revisions
     WHERE id = $1 AND artifact_id = $2`,
    [input.revisionId, input.artifactId],
  );
  if (!revision.rows[0]) throw new ResourceNotFoundError("artifact revision");

  let selected: { id: string; name: string; type: string } | null = null;
  if (input.selectedElementId && artifact.type !== "FORM") {
    const elements = artifact.type === "DMN_DECISION"
      ? await listDmnElements(revision.rows[0].source)
      : await listBpmnElements(revision.rows[0].source);
    selected = elements.find((element) => element.id === input.selectedElementId) ?? null;
  }

  await getPool().query(
    `INSERT INTO artifact_editor_presence
       (organization_id, artifact_id, revision_id, principal_id, client_id,
        selected_element_id, selected_element_name, selected_element_type,
        cursor_x, cursor_y, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (artifact_id, principal_id, client_id) DO UPDATE SET
       revision_id = EXCLUDED.revision_id,
       selected_element_id = EXCLUDED.selected_element_id,
       selected_element_name = EXCLUDED.selected_element_name,
       selected_element_type = EXCLUDED.selected_element_type,
       cursor_x = EXCLUDED.cursor_x,
       cursor_y = EXCLUDED.cursor_y,
       state = EXCLUDED.state,
       last_seen_at = now()`,
    [
      context.organization.id,
      input.artifactId,
      input.revisionId,
      context.principal.id,
      input.clientId,
      selected?.id ?? null,
      selected?.name ?? null,
      selected?.type ?? null,
      input.cursor?.x ?? null,
      input.cursor?.y ?? null,
      input.state ?? "ACTIVE",
    ],
  );
  return listArtifactPresence(context, input.artifactId);
}

export async function leaveArtifactPresence(
  context: PrincipalContext,
  artifactId: string,
  clientId: string,
) {
  assertPermission(context, "artifact:update");
  await assertArtifactAccess(context, artifactId);
  await getPool().query(
    `DELETE FROM artifact_editor_presence
     WHERE artifact_id = $1 AND organization_id = $2
       AND principal_id = $3 AND client_id = $4`,
    [artifactId, context.organization.id, context.principal.id, clientId],
  );
}
