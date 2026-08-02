import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(repoRoot, ".next", "standalone");
const forbiddenRoots = ["data", "prisma"];
const forbiddenPackages = ["@prisma", "prisma"];

async function exists(directory) {
  try {
    await readdir(directory);
    return true;
  } catch {
    return false;
  }
}

const violations = [];
for (const name of forbiddenRoots) {
  if (await exists(path.join(standaloneRoot, name))) {
    violations.push(`standalone contains forbidden root: ${name}`);
  }
}
for (const name of forbiddenPackages) {
  if (await exists(path.join(standaloneRoot, "node_modules", name))) {
    violations.push(`standalone contains forbidden package: ${name}`);
  }
}

if (violations.length > 0) {
  console.error("Standalone artifact check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Standalone artifact check passed: no local business data or Prisma runtime.");
}
