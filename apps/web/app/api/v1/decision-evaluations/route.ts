import { evaluateDecision, listDecisionEvaluations } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { evaluateDecisionSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "decision:read");
    const url = new URL(request.url);
    return apiJson({
      data: await listDecisionEvaluations(context, {
        deploymentId: url.searchParams.get("deploymentId") ?? undefined,
        instanceId: url.searchParams.get("instanceId") ?? undefined,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "decision:evaluate"),
      readJson(request).then((value) => evaluateDecisionSchema.parse(value)),
    ]);
    const evaluation = await evaluateDecision(context, {
      ...body,
      idempotencyKey: request.headers.get("Idempotency-Key"),
    });
    return apiJson(
      { data: evaluation },
      { status: 201, headers: { Location: `/api/v1/decision-evaluations/${evaluation.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
