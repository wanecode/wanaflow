import { createWorkGroup } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { createWorkGroupSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requirePrincipalContext(request, "membership:manage"),
      readJson(request).then((value) => createWorkGroupSchema.parse(value)),
    ]);
    return apiJson({ data: await createWorkGroup(context, body) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
