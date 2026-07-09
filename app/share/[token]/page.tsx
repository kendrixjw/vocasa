"use client";

import { use } from "react";
import ShareViewer from "@/components/ShareViewer";

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <ShareViewer token={token} />;
}
