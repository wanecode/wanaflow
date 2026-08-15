import { FormStudioWorkspace } from "@/components/form-studio-workspace";

export default async function FormStudioPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <FormStudioWorkspace artifactId={artifactId} />;
}
