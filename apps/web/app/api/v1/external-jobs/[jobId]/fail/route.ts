import { failExternalJob } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { failExternalJobSchema } from "@/lib/server/api-schemas";
import { requireJobWorkerContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const [{ jobId }, context, body] = await Promise.all([
      params,
      requireJobWorkerContext(request),
      readJson(request).then((value) => failExternalJobSchema.parse(value)),
    ]);
    return apiJson({ data: await failExternalJob(context, jobId, body) }, { headers: { "X-Wanaflow-Auth-Mode": "worker-bearer" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("X-Wanaflow-Auth-Mode", "worker-bearer");
    return response;
  }
}
