export type ApprovalCategory = "character" | "scene" | "prop";

export type ApprovalSubmissionStatus =
  | "pending"
  | "partially_approved"
  | "approved"
  | "rejected";

export type ApprovalItemStatus = "pending" | "approved" | "rejected";

export type AssetApprovalItem = {
  id: string;
  submissionId: string;
  category: ApprovalCategory;
  assetDesignItemId: string;
  assetNameSnapshot: string;
  generatedMediaId: string;
  generatedAtSnapshot: string;
  storageKey: string;
  promptSnapshot: string | null;
  /** Character voice bound at submit time (optional for older submissions). */
  voiceIdSnapshot?: string | null;
  voiceNameSnapshot?: string | null;
  status: ApprovalItemStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  promotedAssetId: string | null;
};

export type AssetApprovalSubmission = {
  id: string;
  projectId: string;
  episodeId: string;
  submittedByUserId: string;
  approverUserId: string;
  status: ApprovalSubmissionStatus;
  items: AssetApprovalItem[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  completedAt: string | null;
  revision: number;
  idempotencyKey: string | null;
};

export type AssetApprovalsFile = {
  version: 1;
  revision: number;
  updatedAt: string;
  submissions: AssetApprovalSubmission[];
};

/** Candidate media status shown in submit UI */
export type CandidateMediaStatus =
  | "submittable"
  | "pending_approval"
  | "approved"
  | "in_library";

export type ApprovalCandidateMedia = {
  generatedMediaId: string;
  assetDesignItemId: string;
  category: ApprovalCategory;
  assetName: string;
  generatedAt: string;
  prompt: string | null;
  status: CandidateMediaStatus;
  submissionId: string | null;
};
