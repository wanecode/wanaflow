import type { Metadata } from "next";

import { ArtifactLibrary } from "@/components/artifact-library";

export const metadata: Metadata = { title: "Process library" };

export default function LibraryPage() {
  return <ArtifactLibrary />;
}
