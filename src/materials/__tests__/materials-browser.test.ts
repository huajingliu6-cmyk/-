import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import path from "path";
import { pathToFileURL } from "url";

const FIXTURE = path.join(
  process.cwd(),
  "src/materials/__tests__/fixtures/materials-browser-fixture.html",
);

async function isVisible(page: Page, testId: string) {
  return page.getByTestId(testId).isVisible();
}

describe("materials browser flows", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(pathToFileURL(FIXTURE).href);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it("hides admin materials nav for users and shows for admin", async () => {
    await page.evaluate(() =>
      (window as unknown as { __setRole: (r: string) => void }).__setRole("user"),
    );
    expect(await isVisible(page, "nav-materials")).toBe(true);
    expect(await isVisible(page, "nav-admin-materials")).toBe(false);

    await page.evaluate(() =>
      (window as unknown as { __setRole: (r: string) => void }).__setRole("admin"),
    );
    expect(await isVisible(page, "nav-admin-materials")).toBe(true);
    expect(await isVisible(page, "materials-admin")).toBe(true);
  });

  it("upload modal previews image, multi-selects tags, cleans orphan on cancel", async () => {
    await page.evaluate(() =>
      (window as unknown as { __setRole: (r: string) => void }).__setRole("admin"),
    );
    await page.getByTestId("open-upload-modal").click();
    await page.getByTestId("upload-file").setInputFiles({
      name: "x.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    expect(await isVisible(page, "upload-preview")).toBe(true);
    await page.getByTestId("upload-gender-chips").getByText("男装").click();
    await page.getByTestId("upload-theme-chips").getByText("古装").click();
    expect(
      await page
        .getByTestId("upload-gender-chips")
        .getByText("男装")
        .evaluate((el) => el.classList.contains("active")),
    ).toBe(true);
    await page.getByTestId("upload-cancel").click();
    const temp = await page.evaluate(
      () =>
        (window as unknown as { __state: { tempMediaId: string | null } })
          .__state.tempMediaId,
    );
    expect(temp).toBeNull();
    const deletes = await page.evaluate(
      () =>
        (
          window as unknown as {
            __state: { fetches: Array<{ method: string }> };
          }
        ).__state.fetches.filter((f) => f.method === "DELETE").length,
    );
    expect(deletes).toBeGreaterThan(0);
  });

  it("supports gender/theme multi-select filtering", async () => {
    await page.evaluate(() =>
      (window as unknown as { __setRole: (r: string) => void }).__setRole("user"),
    );
    await page.getByTestId("gender-chips").getByText("男装").click();
    await page.getByTestId("theme-chips").getByText("古装").click();
    await page.waitForTimeout(80);
    expect(await isVisible(page, "material-card-m1")).toBe(true);
    expect(await page.getByTestId("material-card-m2").count()).toBe(0);
  });

  it("cites into library with sourceMaterialId and survives soft delete", async () => {
    await page.getByTestId("material-card-m1").click();
    await page.getByTestId("cite-btn").click();
    expect(await isVisible(page, "library-asset-pa-m1")).toBe(true);
    expect(
      await page.getByTestId("library-asset-pa-m1").getAttribute("data-source"),
    ).toBe("m1");
    await page.evaluate(() =>
      (
        window as unknown as { __softDeleteCatalog: (id: string) => void }
      ).__softDeleteCatalog("m1"),
    );
    expect(await page.getByTestId("material-card-m1").count()).toBe(0);
    expect(await isVisible(page, "library-asset-pa-m1")).toBe(true);
  });

  it("blocks clothing import without characterId", async () => {
    await page.getByTestId("material-card-m2").click();
    await page.getByTestId("import-btn").click();
    expect(await page.getByTestId("import-error").innerText()).toContain(
      "CLOTHING_REQUIRES_CHARACTER",
    );
    await page.getByTestId("materials-import-character-id").fill("char-1");
    await page.getByTestId("import-btn").click();
    expect(await page.getByTestId("log").innerText()).toContain(
      "imported:clothing-look",
    );
  });
});
