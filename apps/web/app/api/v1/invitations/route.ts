import { createInvitation } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createInvitationSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "membership:manage"),
      readJson(request).then((value) => createInvitationSchema.parse(value)),
    ]);
    const invitation = await createInvitation(context, body);
    return apiJson({ data: invitation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
