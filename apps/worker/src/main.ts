import { hostname } from "node:os";

import { acceptNextDueTimer, closePool, dispatchNextMessageDelivery } from "@wanaflow/db";

import { runRuntimeWorkOnce } from "./worker";

const workerId = process.env.WANAFLOW_WORKER_ID ?? `${hostname()}:${process.pid}`;
const pollMilliseconds = Math.max(100, Number(process.env.WANAFLOW_WORKER_POLL_MS ?? 750));
let stopping = false;

async function stop() {
  stopping = true;
  await closePool();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function main() {
  console.info(`Wanaflow runtime worker ${workerId} is ready.`);
  while (!stopping) {
    const acceptedTimer = await acceptNextDueTimer();
    const result = await runRuntimeWorkOnce(workerId);
    const delivery = await dispatchNextMessageDelivery(workerId);
    if (result.handled) {
      if ("error" in result) console.error("Runtime work opened an incident", result);
      continue;
    }
    if (acceptedTimer || delivery.handled) continue;
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closePool();
  process.exitCode = 1;
});
