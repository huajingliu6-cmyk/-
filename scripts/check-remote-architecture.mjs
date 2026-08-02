import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repoRoot, "src");
const allowedGenericClient = path.normalize("src/persistence/remote-data-client.ts");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const forbiddenPatterns = [
  { label: "Prisma import in Web source", pattern: /@prisma\/client/ },
  { label: "Prisma client in Web source", pattern: /\bPrismaClient\b/ },
  {
    label: "generic document helper",
    pattern: /\b(?:getRemoteDocument|putRemoteDocument|putRemoteDocumentsAtomic|deleteRemoteDocument)\b/,
    allowedPath: allowedGenericClient,
  },
  {
    label: "generic document endpoint",
    pattern: /\/v1\/documents(?:\/|[\'"`])/,
    allowedPath: allowedGenericClient,
  },
  { label: "Prisma client in production Web", pattern: /@prisma\/client/ },
  {
    label: "legacy Prisma module in production Web",
    pattern: /@\/persistence\/(?:prisma|repositories|services)|@\/projects\/(?:postgres-project-store|identity-bootstrap)/,
  },
];

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...await listSourceFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function requireText(content, expected, label, violations) {
  if (!content.includes(expected)) violations.push(`${label}: missing ${expected}`);
}

function forbidText(content, forbidden, label, violations) {
  if (content.includes(forbidden)) violations.push(`${label}: forbidden ${forbidden}`);
}

const violations = [];
for (const filePath of await listSourceFiles(sourceRoot)) {
  const relativePath = path.normalize(path.relative(repoRoot, filePath));
  const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbiddenPatterns) {
      if (rule.allowedPath === relativePath) continue;
      if (rule.pattern.test(line)) {
        violations.push(`${relativePath}:${index + 1}: ${rule.label}: ${line.trim()}`);
      }
    }
  }
}

const compose = await readFile(path.join(repoRoot, "deploy/compose.remote.yml"), "utf8");
for (const expected of [
  "REMOTE_DATA_ONLY: \"true\"",
  "GO_BACKEND_INTERNAL_URL: http://api:8080",
  "VIDEO_PROVIDER: mock",
  "ALLOW_PAID_GENERATION: \"false\"",
  "TEXT_LLM_PROVIDER: mock",
  "read_only: true",
  "internal: true",
  '"${WEB_PORT:-3080}:3000"',
]) {
  requireText(compose, expected, "deploy/compose.remote.yml", violations);
}
for (const forbidden of [
  /^  ssdb:/m,
  /SSDB_ADDRESS:/,
  /SSDB_PASSWORD:/,
  /SSDB_IMAGE/,
  /ssdb_data/,
]) {
  if (forbidden.test(compose)) {
    violations.push(
      `deploy/compose.remote.yml: production must not include SSDB (${forbidden})`,
    );
  }
}
const webSection = compose.split(/^  postgres:/m)[0];
for (const forbidden of [
  "DATABASE_URL:",
  "SSDB_ADDRESS:",
  "APP_DATA_DIR:",
  "DATA_ROOT:",
  "LOCAL_STORAGE_ROOT:",
  "LOCAL_VOICE_LIBRARY_DIR:",
  "MOCK_VIDEO_FILE:",
  "BLOB_STORAGE_DRIVER:",
  "BLOBSTORE_INTERNAL_URL:",
  "BLOBSTORE_INTERNAL_TOKEN:",
  "ALIYUN_OSS_ENDPOINT:",
  "ALIYUN_OSS_REGION:",
  "ALIYUN_OSS_BUCKET:",
  "ALIYUN_OSS_ACCESS_KEY_ID:",
  "ALIYUN_OSS_ACCESS_KEY_SECRET:",
]) {
  forbidText(webSection, forbidden, "deploy web service", violations);
}
const nonWebSections = compose.split(/^  postgres:/m)[1] ?? "";
if (/^\s+ports:/m.test(nonWebSections)) {
  violations.push("deploy/compose.remote.yml: only the Web service may publish host ports");
}

const runtimeContract = await readFile(
  path.join(repoRoot, "src/persistence/web-runtime-contract.ts"),
  "utf8",
);
for (const expected of [
  'environment.REMOTE_DATA_ONLY !== "true"',
  '"DATABASE_URL"',
  '"SSDB_ADDRESS"',
  '"APP_DATA_DIR"',
  '"LOCAL_VOICE_LIBRARY_DIR"',
  '"MOCK_VIDEO_FILE"',
  '"BLOB_STORAGE_DRIVER"',
  '"BLOBSTORE_INTERNAL_URL"',
  '"BLOBSTORE_INTERNAL_TOKEN"',
  '"ALIYUN_OSS_ACCESS_KEY_SECRET"',
  'hostname === "localhost"',
]) {
  requireText(runtimeContract, expected, "production Web runtime contract", violations);
}

const packageJson = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
if (/\bprisma\s+generate\b/.test(packageJson.scripts?.build ?? "")) {
  violations.push("package.json: production Web build must not generate Prisma client");
}

const envExample = await readFile(path.join(repoRoot, ".env.example"), "utf8");
for (const expected of [
  "VIDEO_PROVIDER=mock",
  "ALLOW_PAID_GENERATION=false",
  "TEXT_LLM_PROVIDER=mock",
  "REMOTE_DATA_ONLY=true",
  "GO_BACKEND_INTERNAL_URL=http://api:8080",
]) {
  requireText(envExample, expected, ".env.example", violations);
}

const nextConfig = await readFile(path.join(repoRoot, "next.config.ts"), "utf8");
requireText(
  nextConfig,
  '"/*": ["./data/**/*"]',
  "Next.js output tracing",
  violations,
);

requireText(
  JSON.stringify(packageJson),
  "node scripts/sanitize-standalone-artifact.mjs",
  "production build artifact sanitizer",
  violations,
);
requireText(
  JSON.stringify(packageJson),
  "node scripts/check-standalone-artifact.mjs",
  "production build artifact gate",
  violations,
);

if (violations.length > 0) {
  console.error("Remote architecture check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    "Remote architecture check passed: dedicated Go APIs, remote-only Web, read-only deployment, and safe provider defaults are enforced.",
  );
}
