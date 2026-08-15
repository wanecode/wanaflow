import { recordAiChoiceResponse } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { recordAiChoiceSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  try {
    const [{ experienceId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:create"),
      readJson(request).then((value) => recordAiChoiceSchema.parse(value)),
    ]);
    await recordAiChoiceResponse(context, experienceId, body);
    return apiJson({ data: { recorded: true } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
