import { completeProcessTask } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { completeProcessTaskSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const [{ taskId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "task:complete"),
      readJson(request).then((value) => completeProcessTaskSchema.parse(value)),
    ]);
    const result = await completeProcessTask(context, taskId, {
      ...body,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? body.idempotencyKey,
    });
    return apiJson({ data: result }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
