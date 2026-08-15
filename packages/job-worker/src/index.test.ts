import { describe, expect, it, vi } from "vitest";

import { WanaflowWorkerClient } from "./index";

describe("WanaflowWorkerClient", () => {
  it("locks jobs with a scoped bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new WanaflowWorkerClient({ baseUrl: "https://flow.example/", token: "wf_job_secret", fetch: fetcher });
    await expect(client.lock({ workerId: "worker-1", jobTypes: ["invoice.send"] })).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("https://flow.example/api/v1/external-jobs/lock", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer wf_job_secret" }),
      body: JSON.stringify({ workerId: "worker-1", jobTypes: ["invoice.send"] }),
    }));
  });
});
