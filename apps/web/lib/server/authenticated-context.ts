import {
  authenticateJobWorkerToken,
  PermissionDeniedError,
  assertPermission,
  resolvePrincipalContext,
  type PrincipalContext,
  type WanaflowPermission,
} from "@wanaflow/db";

import { auth } from "@/lib/auth";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "AuthenticationRequiredError";
  }
}

export async function requirePrincipalContext(
  request: Request,
  permission?: WanaflowPermission,
): Promise<PrincipalContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new AuthenticationRequiredError();

  const context = await resolvePrincipalContext(
    session.user.id,
    request.headers.get("X-Wanaflow-Organization"),
  );
  if (permission) assertPermission(context, permission);
  return context;
}

export async function requireJobWorkerContext(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const [scheme, token] = authorization.split(" ", 2);
  if (scheme !== "Bearer" || !token) throw new AuthenticationRequiredError();
  try {
    return await authenticateJobWorkerToken(token);
  } catch (error) {
    if (error instanceof PermissionDeniedError) throw new AuthenticationRequiredError();
    throw error;
  }
}
