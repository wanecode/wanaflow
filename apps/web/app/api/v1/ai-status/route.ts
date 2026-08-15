import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";
import { aiModelConfiguration } from "@/lib/server/ai-agent";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePrincipalContext(request, "artifact:create");
    const configuration = aiModelConfiguration();
    return apiJson({ data: {
      configured: configuration.configured,
      model: configuration.model,
    } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
