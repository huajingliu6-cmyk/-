"use client";

import { useParams } from "next/navigation";
import { ExtractionCandidateReview } from "@/projects/assets/extraction/ExtractionCandidateReview";

export default function WorkspaceAssetExtractionReviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  return (
    <ExtractionCandidateReview
      projectId={projectId}
      apiRoot={`/api/workspace/projects/${encodeURIComponent(projectId)}`}
      assetsHref={`/app/workspace/projects/${encodeURIComponent(projectId)}/assets/library`}
    />
  );
}
