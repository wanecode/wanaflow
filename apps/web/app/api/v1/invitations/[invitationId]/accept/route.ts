import { randomUUID } from "node:crypto";

import { acceptInvitation, getInvitationPreview, getPool } from "@wanaflow/db";
import { hashPassword, verifyPassword } from "better-auth/crypto";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { acceptInvitationSchema } from "@/lib/server/api-schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  try {
    const { invitationId } = await params;
    return apiJson(
      { data: await getInvitationPreview(invitationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  let createdUserId: string | null = null;
  try {
    const [{ invitationId }, body] = await Promise.all([
      params,
      readJson(request).then((value) => acceptInvitationSchema.parse(value)),
    ]);
    const preview = await getInvitationPreview(invitationId);
    const existing = await getPool().query<{ id: string; password: string | null }>(
      `SELECT app_user.id, credential.password
       FROM "user" app_user
       LEFT JOIN "account" credential
         ON credential."userId" = app_user.id AND credential."providerId" = 'credential'
       WHERE lower(app_user.email) = lower($1)`,
      [preview.email],
    );
    let authUserId = existing.rows[0]?.id;
    if (authUserId) {
      const password = existing.rows[0].password;
      if (!password || !await verifyPassword({ hash: password, password: body.password })) {
        return apiJson(
          { error: { code: "INVITATION_CREDENTIALS_INVALID", message: "That password does not match the existing account." } },
          { status: 409 },
        );
      }
    } else {
      authUserId = randomUUID();
      createdUserId = authUserId;
      const accountId = randomUUID();
      const password = await hashPassword(body.password);
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO "user"
            ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, now(), now())`,
          [authUserId, preview.displayName, preview.email],
        );
        await client.query(
          `INSERT INTO "account"
            ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
           VALUES ($1, $2, 'credential', $3, $4, now(), now())`,
          [accountId, authUserId, authUserId, password],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    await acceptInvitation(invitationId, authUserId);
    return apiJson({ data: { accepted: true, signInUrl: "/sign-in?joined=1" } });
  } catch (error) {
    if (createdUserId) {
      await getPool().query(`DELETE FROM "user" WHERE id = $1`, [createdUserId]).catch(() => undefined);
    }
    return apiError(error);
  }
}
