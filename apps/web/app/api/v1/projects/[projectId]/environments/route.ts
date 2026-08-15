import { createEnvironment, listProjectEnvironments } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createEnvironmentSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const [{ projectId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "environment:read"),
    ]);
    return apiJson(
      { data: await listProjectEnvironments(context, projectId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
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
      requirePrincipalContext(request, "environment:create"),
      readJson(request).then((value) => createEnvironmentSchema.parse(value)),
    ]);
    const environment = await createEnvironment(context, { projectId, ...body });
    return apiJson(
      { data: environment },
      { status: 201, headers: { Location: `/api/v1/environments/${environment.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
