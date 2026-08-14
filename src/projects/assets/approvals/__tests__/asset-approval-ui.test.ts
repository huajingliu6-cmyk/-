import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset approval UI contracts", () => {
  const submit = readSrc(
    "src/projects/assets/approvals/SubmitApprovalModal.tsx",
  );
  const approve = readSrc(
    "src/projects/assets/approvals/OwnerApproveModal.tsx",
  );
  const bell = readSrc("src/shell/NotificationBell.tsx");
  const header = readSrc("src/shell/AuthenticatedHeader.tsx");
  const workspace = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );
  const confirmRoute = readSrc(
    "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/confirm/route.ts",
  );

  it("workspace button uses 提交审批素材 and opens submit modal", () => {
    expect(workspace).toContain("提交审批素材");
    expect(workspace).toContain('data-testid="ead-submit-approval"');
    expect(workspace).toContain("SubmitApprovalModal");
    expect(workspace).toMatch(/surface === "workspace"[\s\S]*ead-submit-approval/);
  });

  it("management keeps 确认本集资产", () => {
    expect(workspace).toContain("确认本集资产");
    expect(workspace).toContain('data-testid="ead-confirm"');
  });

  it("submit modal has three columns and checkboxes", () => {
    expect(submit).toContain("人物图片");
    expect(submit).toContain("场景图片");
    expect(submit).toContain("道具图片");
    expect(submit).toContain("ead-approval-columns");
    expect(submit).toContain('type="checkbox"');
    expect(submit).toContain("提交审批");
    expect(submit).toContain("已选择");
    expect(submit).toContain("当前没有可提交审批的已生成图片");
    expect(submit).toContain("DesignImageLightbox");
  });

  it("owner approve modal has three columns, confirm, and reject X", () => {
    expect(approve).toContain("素材审批");
    expect(approve).toContain("人物图片");
    expect(approve).toContain("场景图片");
    expect(approve).toContain("道具图片");
    expect(approve).toContain("确认审批");
    expect(approve).toContain('type="checkbox"');
    expect(approve).toContain("DesignImageLightbox");
    expect(approve).toContain("部分处理");
    expect(approve).toContain("已通过");
    expect(approve).toContain("已驳回");
    expect(approve).toContain("ead-approval-card__reject");
    expect(approve).toContain("/reject");
  });

  it("notification bell keeps submit unread, allows delete completed, deep-links both roles", () => {
    expect(header).toContain("NotificationBell");
    expect(bell).toContain("notification-unread-badge");
    expect(bell).toContain("approvalSubmissionId");
    expect(bell).toContain("/assets/design?");
    expect(bell).toContain("keepUnreadWhilePending");
    expect(bell).toContain("asset_approval_approved");
    expect(bell).toContain("asset_approval_rejected");
    expect(bell).toContain("/app/workspace/projects/");
    expect(bell).toContain("notification-delete-");
    expect(bell).toContain('method: "DELETE"');
  });

  it("admin page exposes审批记录 backed by admin API", () => {
    const page = readSrc("src/app/app/admin/approvals/page.tsx");
    const tab = readSrc("src/auth/ai-admin/AssetApprovalsHistoryTab.tsx");
    const nav = readSrc("src/admin/nav.ts");
    expect(page).toContain("AssetApprovalsHistoryTab");
    expect(page).toContain("admin-approvals-page");
    expect(nav).toContain("审批记录");
    expect(nav).toContain("/app/admin/approvals");
    expect(tab).toContain("/api/admin/asset-approvals");
    expect(tab).toContain("admin-asset-approvals-history");
  });

  it("closing approve modal strips query so notification can reopen", () => {
    expect(workspace).toContain('next.delete("approvalSubmissionId")');
    expect(workspace).not.toContain("dismissedApprovalSubmissionId");
  });

  it("workspace confirm route blocks formal入库", () => {
    expect(confirmRoute).toContain("WORKSPACE_CONFIRM_REQUIRES_APPROVAL");
    expect(confirmRoute).toContain("403");
    expect(confirmRoute).not.toContain("confirmWorkspaceEpisodeAssetDesign");
  });
});
