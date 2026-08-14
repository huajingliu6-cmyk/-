import { writeFileSync, existsSync } from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const publicDir = path.join(root, "public");
const outPath = path.join(publicDir, "build-info.json");

function gitShort() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

const revision =
  (process.env.BUILD_REVISION || "").trim() ||
  gitShort() ||
  "unknown";
const source =
  (process.env.BUILD_SOURCE || "").trim() ||
  "infinite-canvas";
const builtAt = new Date().toISOString();

const info = {
  source,
  revision,
  builtAt,
  worktree: "infinite-canvas",
};

if (!existsSync(publicDir)) {
  // next build always has public/; if missing, skip quietly
  console.warn("[write-build-info] public/ missing, skip");
  process.exit(0);
}

writeFileSync(outPath, JSON.stringify(info, null, 2) + "\n", "utf8");
console.log(
  `[write-build-info] source=${source} revision=${revision} builtAt=${builtAt}`,
);
