import { lockExternalJobs } from "@wanaflow/db";

import { apiError, apiJson, readJson } from "@/lib/server/api-response";
import { lockExternalJobsSchema } from "@/lib/server/api-schemas";
import { requireJobWorkerContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request) {
  try {
    const [context, body] = await Promise.all([
      requireJobWorkerContext(request),
      readJson(request).then((value) => lockExternalJobsSchema.parse(value)),
    ]);
    return apiJson({ data: await lockExternalJobs(context, body) }, { headers: { "Cache-Control": "private, no-store", "X-Wanaflow-Auth-Mode": "worker-bearer" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("X-Wanaflow-Auth-Mode", "worker-bearer");
    return response;
  }
}
