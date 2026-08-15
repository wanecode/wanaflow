import { DmnStudioWorkspace } from "@/components/dmn-studio-workspace";

export default async function DecisionStudioPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <DmnStudioWorkspace artifactId={artifactId} />;
}
