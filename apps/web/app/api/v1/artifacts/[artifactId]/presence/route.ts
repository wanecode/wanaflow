import {
  leaveArtifactPresence,
  listArtifactPresence,
  touchArtifactPresence,
} from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";
import { artifactPresenceSchema } from "@/lib/server/api-schemas";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:read"),
    ]);
    return apiJson(
      { data: await listArtifactPresence(context, artifactId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:update"),
      readJson(request),
    ]);
    const input = artifactPresenceSchema.parse(body);
    return apiJson({
      data: await touchArtifactPresence(context, {
        artifactId,
        revisionId: input.revisionId,
        clientId: input.clientId,
        selectedElementId: input.selectedElementId,
        cursor: input.cursor,
        state: input.state,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:update"),
    ]);
    const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
    await leaveArtifactPresence(context, artifactId, clientId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
