import { listRuntimeIncidentOwners, updateRuntimeIncident } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { updateRuntimeIncidentSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    const [{ incidentId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "job:retry"),
    ]);
    return apiJson({ data: await listRuntimeIncidentOwners(context, incidentId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ incidentId: string }> },
) {
  try {
    const [{ incidentId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "job:retry"),
      readJson(request),
    ]);
    return apiJson({
      data: await updateRuntimeIncident(context, incidentId, updateRuntimeIncidentSchema.parse(body)),
    });
  } catch (error) {
    return apiError(error);
  }
}
