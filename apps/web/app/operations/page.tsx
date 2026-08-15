import type { Metadata } from "next";

import { OperationsWorkspace } from "@/components/operations-workspace";

export const metadata: Metadata = { title: "Operations" };

export default function OperationsPage() {
  return <OperationsWorkspace />;
}
