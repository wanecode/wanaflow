import { assertWorkspaceAccess, createProject } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createProjectSchema } from "@/lib/server/api-schemas";
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
      readJson(request).then((value) => createProjectSchema.parse(value)),
    ]);
    await assertWorkspaceAccess(context, workspaceId);
    const project = await createProject({
      organizationId: context.organization.id,
      workspaceId,
      principalId: context.principal.id,
      ...body,
    });
    return apiJson(
      { data: project },
      { status: 201, headers: { Location: `/api/v1/projects/${project.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
