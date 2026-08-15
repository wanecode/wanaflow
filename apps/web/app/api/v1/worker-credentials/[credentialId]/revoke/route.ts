import { revokeWorkerCredential } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request, { params }: { params: Promise<{ credentialId: string }> }) {
  try {
    const [{ credentialId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "worker-credential:revoke"),
    ]);
    return apiJson({ data: await revokeWorkerCredential(context, credentialId) });
  } catch (error) {
    return apiError(error);
  }
}
