import {
  listInvitations,
  listWorkGroups,
  listWorkspaceMembers,
} from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "membership:manage");
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    const [members, invitations, groups] = await Promise.all([
      listWorkspaceMembers(context, workspaceId),
      listInvitations(context, workspaceId),
      listWorkGroups(context, workspaceId),
    ]);
    return apiJson(
      { data: { members, invitations, groups } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
