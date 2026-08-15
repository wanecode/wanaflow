import { getPublication } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  try {
    const [{ publicationId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "publication:read"),
    ]);
    return apiJson(
      { data: await getPublication(context, publicationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
