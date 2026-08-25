import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("project creation space contract", () => {
  const page = readSource("src/app/app/projects/page.tsx");
  const wizard = readSource(
    "src/projects/components/CreateProjectWizardDialog.tsx",
  );
  const route = readSource("src/app/api/projects/route.ts");

  it("scopes project listing and creation to the active enterprise", () => {
    expect(page).toContain('params.set("enterpriseId"');
    expect(page).toContain("activeSpace.enterpriseId");
    expect(page).toContain("apiCanCreate === true");
    expect(wizard).toContain("enterpriseId,");
    expect(route).toContain('"projects.assign"');
    expect(route).toContain("assignEnterpriseProjects");
  });

  it("shows approval only for enterprise creation and forces personal off", () => {
    expect(wizard).toMatch(/\{enterpriseId \? \([\s\S]*审批系统[\s\S]*\) : null\}/);
    expect(wizard).toContain(
      "approvalEnabled: enterpriseId ? state.approvalEnabled : false",
    );
    expect(route).toContain(
      "approvalEnabled: enterpriseId ? parsed.value.approvalEnabled : false",
    );
  });

  it("shows project highlights only for enterprise creation", () => {
    expect(wizard).toMatch(/\{enterpriseId \? \([\s\S]*项目要点[\s\S]*\) : null\}/);
    expect(wizard).toContain("仅项目主理人可以修改");
  });
});
