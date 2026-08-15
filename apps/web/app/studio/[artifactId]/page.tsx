import type { Metadata } from "next";

import { StudioWorkspace } from "@/components/studio-workspace";

export const metadata: Metadata = { title: "Studio" };

export default async function ArtifactStudioPage({
  params,
}: {
  params: Promise<{ artifactId: string }>;
}) {
  const { artifactId } = await params;
  return <StudioWorkspace artifactId={artifactId} />;
}
