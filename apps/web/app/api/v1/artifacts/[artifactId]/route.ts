import { assertProjectAccess, getArtifact } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context] = await Promise.all([
      params,
      requirePrincipalContext(_request, "artifact:read"),
    ]);
    const artifact = await getArtifact(context.organization.id, artifactId);
    await assertProjectAccess(context, artifact.projectId);
    return apiJson(
      { data: artifact },
      {
        headers: {
          ETag: `"${artifact.revision.id}"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
