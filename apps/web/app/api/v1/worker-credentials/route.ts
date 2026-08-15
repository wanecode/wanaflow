import { createWorkerCredential, listWorkerCredentials } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createWorkerCredentialSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "worker-credential:read");
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    return apiJson({ data: await listWorkerCredentials(context, projectId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "worker-credential:create"),
      readJson(request).then((value) => createWorkerCredentialSchema.parse(value)),
    ]);
    return apiJson({ data: await createWorkerCredential(context, body) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
