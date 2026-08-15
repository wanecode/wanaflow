import type { Metadata } from "next";

import { TaskInbox } from "@/components/task-inbox";

export const metadata: Metadata = { title: "Task inbox" };

export default function InboxPage() {
  return <TaskInbox />;
}
