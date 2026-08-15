import { getReview } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  try {
    const [{ reviewId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:read"),
    ]);
    return apiJson(
      { data: await getReview(context, reviewId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
