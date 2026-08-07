import { redirect } from "next/navigation";
import { workspaceProjectAssetsPath } from "@/shell/nav";

type PageProps = {
  params: Promise<{ projectId: string }>;
};

/**
 * Workspace project root no longer renders an empty overview shell;
 * redirect straight into the assets entry (assets may further redirect to design by role).
 */
export default async function WorkspaceProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  if (!projectId) {
    redirect("/app/workspace");
  }
  redirect(workspaceProjectAssetsPath(projectId));
}
