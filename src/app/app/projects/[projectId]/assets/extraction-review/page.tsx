"use client";

import { useParams } from "next/navigation";
import { ExtractionCandidateReview } from "@/projects/assets/extraction/ExtractionCandidateReview";

export default function AssetExtractionReviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  return (
    <ExtractionCandidateReview
      projectId={projectId}
      apiRoot={`/api/projects/${encodeURIComponent(projectId)}`}
      assetsHref={`/app/projects/${encodeURIComponent(projectId)}/assets/library`}
    />
  );
}
