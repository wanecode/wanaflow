import { addReviewComment } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createReviewCommentSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  try {
    const [{ reviewId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:comment"),
      readJson(request).then((value) => createReviewCommentSchema.parse(value)),
    ]);
    return apiJson(
      { data: await addReviewComment(context, reviewId, body) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
