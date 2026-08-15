import { createReview } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createReviewSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:create"),
      readJson(request).then((value) => createReviewSchema.parse(value)),
    ]);
    const review = await createReview(context, { artifactId, ...body });
    return apiJson(
      { data: review },
      { status: 201, headers: { Location: `/api/v1/reviews/${review.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
