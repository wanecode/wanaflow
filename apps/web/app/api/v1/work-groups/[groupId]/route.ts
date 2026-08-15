import { updateWorkGroup } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { updateWorkGroupSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const [{ groupId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "membership:manage"),
      readJson(request).then((value) => updateWorkGroupSchema.parse(value)),
    ]);
    return apiJson({ data: await updateWorkGroup(context, groupId, body) });
  } catch (error) {
    return apiError(error);
  }
}
