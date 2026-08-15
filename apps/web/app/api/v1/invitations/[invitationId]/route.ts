import { revokeInvitation } from "@wanaflow/db";

import { apiError } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  try {
    const [{ invitationId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "membership:manage"),
    ]);
    await revokeInvitation(context, invitationId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
