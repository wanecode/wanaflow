import type { Metadata } from "next";

import { OperationsWorkspace } from "@/components/operations-workspace";

export const metadata: Metadata = { title: "Instance timeline" };

export default async function InstanceOperationsPage({
  params,
}: {
  params: Promise<{ instanceId: string }>;
}) {
  const { instanceId } = await params;
  return <OperationsWorkspace initialInstanceId={instanceId} />;
}
