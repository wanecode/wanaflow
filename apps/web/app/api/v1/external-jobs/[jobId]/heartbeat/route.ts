import { heartbeatExternalJob } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { heartbeatExternalJobSchema } from "@/lib/server/api-schemas";
import { requireJobWorkerContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const [{ jobId }, context, body] = await Promise.all([
      params,
      requireJobWorkerContext(request),
      readJson(request).then((value) => heartbeatExternalJobSchema.parse(value)),
    ]);
    return apiJson({ data: await heartbeatExternalJob(context, jobId, body) }, { headers: { "X-Wanaflow-Auth-Mode": "worker-bearer" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("X-Wanaflow-Auth-Mode", "worker-bearer");
    return response;
  }
}
