import type { Metadata } from "next";

import { ReviewWorkspace } from "@/components/review-workspace";

export const metadata: Metadata = { title: "Review" };

export default function ReviewsPage() {
  return <ReviewWorkspace />;
}
