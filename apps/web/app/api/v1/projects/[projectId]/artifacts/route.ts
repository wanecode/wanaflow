import { assertProjectAccess, createArtifact, listProjectArtifacts } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createArtifactSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const [{ projectId }, context] = await Promise.all([
      params,
      requirePrincipalContext(_request, "project:read"),
    ]);
    await assertProjectAccess(context, projectId);
    const artifacts = await listProjectArtifacts(context.organization.id, projectId);
    return apiJson({ data: artifacts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const [{ projectId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:create"),
      readJson(request).then((value) => createArtifactSchema.parse(value)),
    ]);
    await assertProjectAccess(context, projectId);
    const artifact = await createArtifact({
      organizationId: context.organization.id,
      projectId,
      principalId: context.principal.id,
      ...body,
    });
    return apiJson(
      { data: artifact },
      {
        status: 201,
        headers: {
          ETag: `"${artifact.revision.id}"`,
          Location: `/api/v1/artifacts/${artifact.id}`,
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
