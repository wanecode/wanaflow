import {
  assertRuntimeClaimProjection,
  claimNextRuntimeWork,
  commitRuntimeWork,
  failRuntimeWork,
  type RuntimeWorkClaim,
} from "@wanaflow/db";
import {
  BpmnEngineAdapter,
  RuntimeAdapterError,
  RuntimeProfileError,
  type RuntimeEnginePort,
} from "@wanaflow/runtime";

function failure(error: unknown) {
  if (error instanceof RuntimeAdapterError || error instanceof RuntimeProfileError) {
    return { code: error.code, message: error.message };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "RUNTIME_WORKER_FAILURE",
    message: error instanceof Error ? error.message : "The runtime worker failed unexpectedly.",
  };
}

async function advance(claim: RuntimeWorkClaim, adapter: RuntimeEnginePort) {
  await assertRuntimeClaimProjection(claim);
  if (claim.commandType === "START") {
    return adapter.start({
      instanceId: claim.instanceId,
      deploymentHash: claim.deploymentHash,
      source: claim.source,
      variables: claim.variables,
      decisions: claim.decisions,
    });
  }
  const target = claim.targetTask ?? claim.targetJob ?? claim.targetTimer ?? claim.targetSubscription;
  if (!claim.envelope || !target) {
    throw new RuntimeAdapterError(
      "MISSING_RUNTIME_CHECKPOINT",
      "A completion command requires a persisted checkpoint and matching wait.",
    );
  }
  return adapter.resume({
    instanceId: claim.instanceId,
    deploymentHash: claim.deploymentHash,
    source: claim.source,
    variables: claim.variables,
    decisions: claim.decisions,
    envelope: claim.envelope,
    signal: { executionId: target.executionId, output: claim.output },
  });
}

export async function runRuntimeWorkOnce(
  workerId: string,
  adapter: RuntimeEnginePort = new BpmnEngineAdapter(),
) {
  const claim = await claimNextRuntimeWork(workerId);
  if (!claim) return { handled: false as const };
  try {
    const result = await advance(claim, adapter);
    const committed = await commitRuntimeWork(claim, result);
    return { handled: true as const, committed, instanceId: claim.instanceId };
  } catch (error) {
    const incidentOpened = await failRuntimeWork(claim, failure(error));
    return {
      handled: true as const,
      committed: false,
      incidentOpened,
      instanceId: claim.instanceId,
      error: failure(error),
    };
  }
}
