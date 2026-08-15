import { simulateArtifactDraft } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";
import { draftSimulationSchema } from "@/lib/server/api-schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:read"),
      readJson(request),
    ]);
    const input = draftSimulationSchema.parse(body);
    return apiJson({
      data: await simulateArtifactDraft(context, {
        artifactId,
        revisionId: input.revisionId,
        variables: input.variables as Record<string, unknown>,
        envelope: input.envelope,
        signal: input.signal ? {
          executionId: input.signal.executionId,
          output: input.signal.output as Record<string, unknown>,
        } : undefined,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
