"use client";

import { WorkflowEditor } from "@/workflow/components/WorkflowEditor";

export default function Home() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-zinc-950">
      <WorkflowEditor />
    </main>
  );
}
