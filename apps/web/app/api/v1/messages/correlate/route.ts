import { correlateMessage } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { correlateMessageSchema, idempotencyKeySchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request) {
  try {
    const [context, body, idempotencyKey] = await Promise.all([
      requirePrincipalContext(request, "message:correlate"),
      readJson(request).then((value) => correlateMessageSchema.parse(value)),
      Promise.resolve(idempotencyKeySchema.parse(request.headers.get("Idempotency-Key"))),
    ]);
    const result = await correlateMessage(context, { ...body, idempotencyKey });
    if (result.outcome === "AMBIGUOUS") {
      return apiJson({
        error: {
          code: "AMBIGUOUS_MESSAGE_CORRELATION",
          message: "More than one active subscription matches this message contract.",
        },
        data: result,
      }, { status: 409 });
    }
    return apiJson(
      { data: result },
      result.outcome === "CORRELATED"
        ? { status: 202, headers: { Location: `/api/v1/message-subscriptions/${result.subscription!.id}` } }
        : { status: 200 },
    );
  } catch (error) {
    return apiError(error);
  }
}
