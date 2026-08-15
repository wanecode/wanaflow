import { assertProjectAccess, getArtifact, saveArtifactRevision } from "@wanaflow/db";

import { apiError, apiJson, readIfMatch, readJson } from "@/lib/server/api-response";
import { saveRevisionSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:update"),
      readJson(request).then((value) => saveRevisionSchema.parse(value)),
    ]);
    const baseRevisionId = readIfMatch(request);
    const current = await getArtifact(context.organization.id, artifactId);
    await assertProjectAccess(context, current.projectId);
    const result = await saveArtifactRevision({
      organizationId: context.organization.id,
      artifactId,
      principalId: context.principal.id,
      baseRevisionId,
      source: body.source,
    });
    return apiJson(
      { data: result.artifact, meta: { created: result.created } },
      {
        status: result.created ? 201 : 200,
        headers: {
          ETag: `"${result.artifact.revision.id}"`,
          Location: `/api/v1/artifacts/${artifactId}`,
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
