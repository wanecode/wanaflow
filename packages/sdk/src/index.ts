export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export type DecisionEvaluation = {
  id: string;
  deploymentId: string;
  environmentId: string;
  decisionArtifactVersionId: string;
  decisionKey: string;
  decision: { id: string; name: string; hitPolicy: "UNIQUE" | "FIRST" };
  input: JsonObject;
  output: JsonObject | null;
  matchedRuleIds: string[];
  outcome: "MATCHED" | "NO_MATCH";
  source: {
    instanceId: string;
    elementId: string;
    elementName: string;
    checkpointRevision: number;
  } | null;
  createdAt: string;
};

export class WanaflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "WanaflowError";
  }
}

export class WanaflowClient {
  readonly baseUrl: string;
  readonly sessionCookie?: string;
  readonly organizationId?: string;
  readonly fetch: typeof globalThis.fetch;

  constructor(input: { baseUrl: string; sessionCookie?: string; organizationId?: string; fetch?: typeof globalThis.fetch }) {
    this.baseUrl = input.baseUrl.replace(/\/$/, "");
    this.sessionCookie = input.sessionCookie;
    this.organizationId = input.organizationId;
    this.fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.sessionCookie) headers.set("Cookie", this.sessionCookie);
    if (this.organizationId) headers.set("X-Wanaflow-Organization", this.organizationId);
    const response = await this.fetch(`${this.baseUrl}${path}`, { credentials: "include", ...init, headers });
    const body = await response.json() as { data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || body.data === undefined) {
      throw new WanaflowError(
        body.error?.message ?? `Wanaflow request failed with status ${response.status}.`,
        response.status,
        body.error?.code ?? "REQUEST_FAILED",
      );
    }
    return body.data;
  }

  evaluateDecision(input: {
    deploymentId: string;
    decisionKey: string;
    input: JsonObject;
    idempotencyKey: string;
  }) {
    return this.request<DecisionEvaluation>("/api/v1/decision-evaluations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        deploymentId: input.deploymentId,
        decisionKey: input.decisionKey,
        input: input.input,
      }),
    });
  }

  getDecisionEvaluation(evaluationId: string) {
    return this.request<DecisionEvaluation>(`/api/v1/decision-evaluations/${encodeURIComponent(evaluationId)}`);
  }

  listDecisionEvaluations(input: { deploymentId?: string; instanceId?: string } = {}) {
    const query = new URLSearchParams();
    if (input.deploymentId) query.set("deploymentId", input.deploymentId);
    if (input.instanceId) query.set("instanceId", input.instanceId);
    return this.request<DecisionEvaluation[]>(`/api/v1/decision-evaluations${query.size ? `?${query}` : ""}`);
  }
}
