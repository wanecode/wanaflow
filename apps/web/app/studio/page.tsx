import type { Metadata } from "next";

import { StudioWorkspace } from "@/components/studio-workspace";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  return <StudioWorkspace />;
}
