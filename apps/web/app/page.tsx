import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { TodayWorkspace } from "@/components/today-workspace";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const firstName = session?.user.name.trim().split(/\s+/)[0] || "there";

  return <TodayWorkspace firstName={firstName} />;
}
