import { createAiExperience } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createAiExperienceSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "artifact:create"),
      readJson(request).then((value) => createAiExperienceSchema.parse(value)),
    ]);
    const experience = await createAiExperience(context, body);
    return apiJson(
      { data: experience },
      { status: 201, headers: { Location: `/api/v1/ai-experiences/${experience.id}` } },
    );
  } catch (error) {
    return apiError(error);
  }
}
