import { decideReview } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { reviewDecisionSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  try {
    const [{ reviewId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:decide"),
      readJson(request).then((value) => reviewDecisionSchema.parse(value)),
    ]);
    return apiJson({ data: await decideReview(context, reviewId, body) });
  } catch (error) {
    return apiError(error);
  }
}
