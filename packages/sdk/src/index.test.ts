import { describe, expect, it, vi } from "vitest";

import { WanaflowClient } from "./index";

describe("WanaflowClient decision evaluation", () => {
  it("sends the immutable deployment contract with caller idempotency", async () => {
    let sentInit: RequestInit | undefined;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ data: { id: "evaluation-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = new WanaflowClient({ baseUrl: "https://wanaflow.test/", sessionCookie: "wanaflow.session_token=secret", fetch });
    await client.evaluateDecision({
      deploymentId: "deployment-1",
      decisionKey: "invoice-route",
      input: { amount: 1200 },
      idempotencyKey: "invoice-42-route",
    });
    expect(fetch).toHaveBeenCalledWith("https://wanaflow.test/api/v1/decision-evaluations", expect.objectContaining({ method: "POST" }));
    expect(new Headers(sentInit?.headers)).toMatchObject(expect.any(Headers));
    expect(new Headers(sentInit?.headers).get("Idempotency-Key")).toBe("invoice-42-route");
    expect(new Headers(sentInit?.headers).get("Cookie")).toBe("wanaflow.session_token=secret");
  });
});
