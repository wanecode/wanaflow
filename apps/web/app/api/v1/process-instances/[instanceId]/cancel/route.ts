import { cancelProcessInstance } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { cancelProcessInstanceSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  try {
    const [{ instanceId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "instance:cancel"),
      readJson(request).then((value) => cancelProcessInstanceSchema.parse(value)),
    ]);
    return apiJson({ data: await cancelProcessInstance(context, instanceId, body) });
  } catch (error) {
    return apiError(error);
  }
}
