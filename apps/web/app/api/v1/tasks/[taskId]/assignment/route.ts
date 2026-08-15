import { listTaskAssigneeCandidates, updateProcessTaskAssignment } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { updateProcessTaskAssignmentSchema } from "@/lib/server/api-schemas";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const [{ taskId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "task:assign"),
    ]);
    return apiJson({ data: await listTaskAssigneeCandidates(context, taskId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const [{ taskId }, context, body] = await Promise.all([
      params,
      requirePrincipalContext(request, "task:assign"),
      readJson(request),
    ]);
    return apiJson({
      data: await updateProcessTaskAssignment(
        context,
        taskId,
        updateProcessTaskAssignmentSchema.parse(body),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
