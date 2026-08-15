import type { Metadata } from "next";

import { AiExperienceWorkspace } from "@/components/ai-experience-workspace";

export const metadata: Metadata = { title: "Experience studio" };

export default async function ExperienceStudioPage({
  params,
}: {
  params: Promise<{ experienceId: string }>;
}) {
  const { experienceId } = await params;
  return <AiExperienceWorkspace experienceId={experienceId} />;
}
