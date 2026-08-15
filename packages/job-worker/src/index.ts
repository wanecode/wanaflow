export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export type LockedJob = {
  id: string;
  instanceId: string;
  processName: string;
  businessKey: string | null;
  elementId: string;
  elementName: string;
  jobType: string;
  input: JsonObject;
  headers: Record<string, null | boolean | number | string>;
  effectKey: string;
  deliveryId: string;
  attempt: number;
  retryCycle: number;
  cycleAttempt: number;
  fencingToken: number;
  lockExpiresAt: string;
};

export type JobHandlerContext = {
  job: LockedJob;
  signal: AbortSignal;
};

export type JobHandler = (context: JobHandlerContext) => Promise<JsonObject | void>;

export type WorkerClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
};

export class WanaflowWorkerError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "WanaflowWorkerError";
  }
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class WanaflowWorkerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: WorkerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.baseUrl || !this.token || !this.fetcher) throw new Error("baseUrl, token, and fetch are required.");
  }

  private async request<T>(path: string, body: JsonObject, idempotencyKey?: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || payload.data === undefined) {
      throw new WanaflowWorkerError(
        payload.error?.message ?? `Wanaflow returned ${response.status}.`,
        response.status,
        payload.error?.code ?? "REQUEST_FAILED",
      );
    }
    return payload.data;
  }

  lock(input: { workerId: string; jobTypes: string[]; maxJobs?: number }) {
    return this.request<LockedJob[]>("/api/v1/external-jobs/lock", input as unknown as JsonObject);
  }

  heartbeat(job: LockedJob, workerId: string, fencingToken = job.fencingToken) {
    return this.request<{ jobId: string; deliveryId: string; fencingToken: number; lockExpiresAt: string }>(
      `/api/v1/external-jobs/${job.id}/heartbeat`,
      { deliveryId: job.deliveryId, workerId, fencingToken },
    );
  }

  complete(job: LockedJob, workerId: string, fencingToken: number, result: JsonObject = {}) {
    return this.request<{ accepted: true; commandId: string; jobId: string }>(
      `/api/v1/external-jobs/${job.id}/complete`,
      { deliveryId: job.deliveryId, workerId, fencingToken, result },
      `${job.deliveryId}:complete`,
    );
  }

  fail(job: LockedJob, workerId: string, fencingToken: number, error: { code: string; message: string }) {
    return this.request<{ status: "RETRY_SCHEDULED" | "INCIDENT" }>(
      `/api/v1/external-jobs/${job.id}/fail`,
      { deliveryId: job.deliveryId, workerId, fencingToken, code: error.code, message: error.message },
    );
  }

  async work(input: {
    workerId: string;
    jobTypes: string[];
    handler: JobHandler;
    maxJobs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    onError?: (error: unknown, job?: LockedJob) => void;
  }) {
    const pollIntervalMs = Math.max(100, input.pollIntervalMs ?? 750);
    while (!input.signal?.aborted) {
      let jobs: LockedJob[];
      try {
        jobs = await this.lock({ workerId: input.workerId, jobTypes: input.jobTypes, maxJobs: input.maxJobs });
      } catch (error) {
        input.onError?.(error);
        await delay(pollIntervalMs, input.signal);
        continue;
      }
      if (!jobs.length) {
        await delay(pollIntervalMs, input.signal);
        continue;
      }
      await Promise.all(jobs.map(async (job) => {
        let fencingToken = job.fencingToken;
        let lockExpiresAt = job.lockExpiresAt;
        const heartbeatController = new AbortController();
        const heartbeatLoop = (async () => {
          while (!heartbeatController.signal.aborted) {
            const remaining = new Date(lockExpiresAt).getTime() - Date.now();
            await delay(Math.max(1000, Math.floor(remaining / 3)), heartbeatController.signal);
            if (heartbeatController.signal.aborted) break;
            const renewed = await this.request<{ fencingToken: number; lockExpiresAt: string }>(
              `/api/v1/external-jobs/${job.id}/heartbeat`,
              { deliveryId: job.deliveryId, workerId: input.workerId, fencingToken },
            );
            fencingToken = renewed.fencingToken;
            lockExpiresAt = renewed.lockExpiresAt;
          }
        })();
        try {
          const result = await input.handler({ job, signal: input.signal ?? new AbortController().signal });
          heartbeatController.abort();
          await heartbeatLoop;
          await this.complete(job, input.workerId, fencingToken, result ?? {});
        } catch (error) {
          heartbeatController.abort();
          try { await heartbeatLoop; } catch (heartbeatError) { input.onError?.(heartbeatError, job); }
          try {
            await this.fail(job, input.workerId, fencingToken, {
              code: error instanceof WanaflowWorkerError ? error.code : "HANDLER_FAILED",
              message: error instanceof Error ? error.message : "The job handler failed.",
            });
          } catch (failError) {
            input.onError?.(failError, job);
          }
          input.onError?.(error, job);
        }
      }));
    }
  }
}
