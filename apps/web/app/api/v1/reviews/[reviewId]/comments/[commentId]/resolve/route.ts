import { resolveReviewComment } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string; commentId: string }> },
) {
  try {
    const [{ reviewId, commentId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:comment"),
    ]);
    return apiJson({ data: await resolveReviewComment(context, reviewId, commentId) });
  } catch (error) {
    return apiError(error);
  }
}
