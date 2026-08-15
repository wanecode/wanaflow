import { importProjectPackage } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const [{ workspaceId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "project:create"),
      readJson(request),
    ]);
    return apiJson({ data: await importProjectPackage(context, workspaceId, body) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
