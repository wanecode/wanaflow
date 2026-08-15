import { createHash, randomUUID } from "node:crypto";

import { assertPermission } from "./authorization";
import { ResourceNotFoundError } from "./errors";
import { getPool, withTransaction } from "./pool";
import type { PrincipalContext, ProcessTimer } from "./types";

type TimerRow = {
  id: string;
  instance_id: string;
  process_name: string;
  business_key: string | null;
  checkpoint_revision: number;
  element_id: string;
  element_name: string;
  timer_type: "DURATION" | "DATE";
  expression: string;
  duration_milliseconds: string | null;
  due_at: Date;
  status: "WAITING" | "FIRED" | "CANCELLED";
  completion_pending: boolean;
  created_at: Date;
  fired_at: Date | null;
};

const TIMER_SELECT = `
  SELECT timer.id, timer.instance_id, instance.process_name, instance.business_key,
    timer.checkpoint_revision, timer.element_id, timer.element_name,
    timer.timer_type, timer.expression, timer.duration_milliseconds::text,
    timer.due_at,
    CASE WHEN instance.status = 'CANCELLED' AND timer.status = 'WAITING'
      THEN 'CANCELLED' ELSE timer.status END AS status,
    EXISTS (
      SELECT 1 FROM runtime_commands pending
      WHERE pending.id = instance.pending_command_id
        AND pending.target_timer_id = timer.id
        AND pending.status IN ('ACCEPTED', 'CLAIMED')
    ) AS completion_pending,
    timer.created_at, timer.fired_at
  FROM process_timers timer
  JOIN process_instances instance
    ON instance.id = timer.instance_id AND instance.organization_id = timer.organization_id
  JOIN projects project
    ON project.id = instance.project_id AND project.organization_id = instance.organization_id
`;

function mapTimer(row: TimerRow): ProcessTimer {
  return {
    id: row.id,
    instanceId: row.instance_id,
    processName: row.process_name,
    businessKey: row.business_key,
    checkpointRevision: row.checkpoint_revision,
    elementId: row.element_id,
    elementName: row.element_name,
    timerType: row.timer_type,
    expression: row.expression,
    durationMilliseconds: row.duration_milliseconds === null ? null : Number(row.duration_milliseconds),
    dueAt: row.due_at.toISOString(),
    status: row.status,
    completionPending: row.completion_pending,
    createdAt: row.created_at.toISOString(),
    firedAt: row.fired_at?.toISOString() ?? null,
  };
}

export async function listProcessTimers(
  context: PrincipalContext,
  filter: { instanceId?: string; status?: ProcessTimer["status"] } = {},
): Promise<ProcessTimer[]> {
  assertPermission(context, "timer:read");
  const result = await getPool().query<TimerRow>(
    `${TIMER_SELECT}
     WHERE timer.organization_id = $1
       AND ($2::uuid IS NULL OR project.workspace_id = $2)
       AND ($3::uuid IS NULL OR timer.instance_id = $3)
       AND ($4::text IS NULL OR
         CASE WHEN instance.status = 'CANCELLED' AND timer.status = 'WAITING'
           THEN 'CANCELLED' ELSE timer.status END = $4)
     ORDER BY timer.created_at DESC, timer.id DESC`,
    [context.organization.id, context.workspaceScopeId, filter.instanceId ?? null, filter.status ?? null],
  );
  return result.rows.map(mapTimer);
}

export async function getProcessTimer(context: PrincipalContext, timerId: string): Promise<ProcessTimer> {
  assertPermission(context, "timer:read");
  const result = await getPool().query<TimerRow>(
    `${TIMER_SELECT}
     WHERE timer.id = $1 AND timer.organization_id = $2
       AND ($3::uuid IS NULL OR project.workspace_id = $3)`,
    [timerId, context.organization.id, context.workspaceScopeId],
  );
  if (!result.rows[0]) throw new ResourceNotFoundError("timer");
  return mapTimer(result.rows[0]);
}

export async function acceptNextDueTimer(): Promise<{
  timerId: string;
  instanceId: string;
  commandId: string;
} | null> {
  return withTransaction(async (client) => {
    const due = await client.query<{
      id: string;
      organization_id: string;
      instance_id: string;
      revision: number;
      created_by: string;
    }>(
      `SELECT timer.id, timer.organization_id, timer.instance_id,
         instance.revision, instance.created_by
       FROM process_timers timer
       JOIN process_instances instance
         ON instance.id = timer.instance_id AND instance.organization_id = timer.organization_id
       WHERE timer.status = 'WAITING' AND timer.due_at <= now()
         AND timer.checkpoint_revision = instance.revision
         AND instance.status = 'WAITING' AND instance.pending_command_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM runtime_commands command WHERE command.target_timer_id = timer.id
         )
       ORDER BY timer.due_at ASC, timer.created_at ASC
       FOR UPDATE OF timer, instance SKIP LOCKED
       LIMIT 1`,
    );
    const timer = due.rows[0];
    if (!timer) return null;
    const commandId = randomUUID();
    const requestSha256 = createHash("sha256")
      .update(`TIMER_FIRE:${timer.id}:${timer.revision}`, "utf8")
      .digest("hex");
    await client.query(
      `INSERT INTO runtime_commands
        (id, organization_id, instance_id, type, status, expected_revision,
         target_timer_id, payload, request_sha256, created_by)
       VALUES ($1, $2, $3, 'TIMER_FIRE', 'ACCEPTED', $4, $5, '{}'::jsonb, $6, $7)`,
      [commandId, timer.organization_id, timer.instance_id, timer.revision, timer.id, requestSha256, timer.created_by],
    );
    await client.query(
      `UPDATE process_instances SET pending_command_id = $1, updated_at = now()
       WHERE id = $2`,
      [commandId, timer.instance_id],
    );
    await client.query(
      `INSERT INTO durable_work
        (id, organization_id, instance_id, command_id, kind, status)
       VALUES ($1, $2, $3, $4, 'ADVANCE_INSTANCE', 'AVAILABLE')`,
      [randomUUID(), timer.organization_id, timer.instance_id, commandId],
    );
    await client.query(
      `INSERT INTO outbox_events
        (organization_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'process_timer.fire_accepted', 'process_timer', $2, $3::jsonb)`,
      [timer.organization_id, timer.id, JSON.stringify({
        timerId: timer.id,
        instanceId: timer.instance_id,
        commandId,
        expectedRevision: timer.revision,
      })],
    );
    return { timerId: timer.id, instanceId: timer.instance_id, commandId };
  });
}
