import { listProcessInstances, startProcessInstance } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { startProcessInstanceSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "instance:read");
    return apiJson(
      { data: await listProcessInstances(context) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "instance:start"),
      readJson(request).then((value) => startProcessInstanceSchema.parse(value)),
    ]);
    const instance = await startProcessInstance(context, {
      ...body,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? body.idempotencyKey,
    });
    return apiJson(
      { data: instance },
      { status: 202, headers: { Location: `/api/v1/process-instances/${instance.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
