import type { Metadata } from "next";

import { AiExperienceCreate } from "@/components/ai-experience-create";

export const metadata: Metadata = { title: "Create with Wana" };

export default function CreateExperiencePage() {
  return <AiExperienceCreate />;
}
