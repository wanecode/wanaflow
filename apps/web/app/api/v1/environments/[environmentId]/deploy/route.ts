import { deployPublication } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { deployPublicationSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ environmentId: string }> },
) {
  try {
    const [{ environmentId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "deployment:create"),
      readJson(request).then((value) => deployPublicationSchema.parse(value)),
    ]);
    const deployment = await deployPublication(context, { environmentId, ...body });
    return apiJson(
      { data: deployment },
      { status: 201, headers: { Location: `/api/v1/deployments/${deployment.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
