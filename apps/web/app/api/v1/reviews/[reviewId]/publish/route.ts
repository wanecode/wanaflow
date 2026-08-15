import { createPublication } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  try {
    const [{ reviewId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "publication:create"),
    ]);
    const publication = await createPublication(context, reviewId);
    return apiJson(
      { data: publication },
      { status: 201, headers: { Location: `/api/v1/publications/${publication.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
