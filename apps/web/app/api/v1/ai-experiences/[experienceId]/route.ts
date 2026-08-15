import { getAiExperience, updateAiExperienceTranscript } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { updateAiExperienceSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  try {
    const [{ experienceId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:read"),
    ]);
    return apiJson(
      { data: await getAiExperience(context, experienceId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  try {
    const [{ experienceId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:create"),
      readJson(request).then((value) => updateAiExperienceSchema.parse(value)),
    ]);
    return apiJson({
      data: await updateAiExperienceTranscript(context, experienceId, body.transcript),
    });
  } catch (error) {
    return apiError(error);
  }
}
