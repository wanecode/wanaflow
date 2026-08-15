import { cancelReview } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  try {
    const [{ reviewId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:cancel"),
    ]);
    return apiJson({ data: await cancelReview(context, reviewId) });
  } catch (error) {
    return apiError(error);
  }
}
