import { notFound } from "next/navigation";
import { AssetManagementWorkspace } from "@/projects/assets/AssetManagementWorkspace";

export default function AssetFusionPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <AssetManagementWorkspace
      projectId="asset-fusion-preview"
      context="management"
      previewMode
    />
  );
}
