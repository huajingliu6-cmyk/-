import { z } from "zod";

const REJECTED_KEY_PATTERN =
  /^(id|existingAssetId|libraryAssetId|projectId|modelId|providerModelId|base64)$/i;

const DangerousKeySchema = z
  .string()
  .refine(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
    { message: "危险字段名" },
  );

const MAX_WALK_DEPTH = 12;
const MAX_STRING_CHARS = 20_000;
const MAX_ARRAY_LENGTH = 500;

/**
 * Hard safety gate — must run on raw parsed JSON before any field projection.
 */
export function rejectDangerousKeys(
  value: unknown,
  path: string[] = [],
  depth = 0,
): string | null {
  if (depth > MAX_WALK_DEPTH) {
    return `对象嵌套过深：${path.join(".") || "(root)"}`;
  }
  if (typeof value === "string") {
    if (value.length > MAX_STRING_CHARS) {
      return `字符串过长：${path.join(".") || "(root)"}`;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      return `数组过大：${path.join(".") || "(root)"}`;
    }
    const nonStringHeavy = value.some(
      (item) => item !== null && typeof item === "object",
    );
    if (nonStringHeavy && value.length > 200) {
      return `非字符串巨型数组：${path.join(".") || "(root)"}`;
    }
    for (let i = 0; i < value.length; i += 1) {
      const hit = rejectDangerousKeys(value[i], [...path, String(i)], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const check = DangerousKeySchema.safeParse(key);
    if (!check.success) {
      return `包含危险字段：${key}`;
    }
    if (REJECTED_KEY_PATTERN.test(key)) {
      return `包含不允许的字段：${key}`;
    }
    const lower = key.toLowerCase();
    if (
      lower.includes("base64") ||
      lower.includes("filepath") ||
      (lower.includes("path") && lower !== "pathos")
    ) {
      // Allow benign keys that merely contain "path" as a substring of unrelated words?
      // Keep historical rule: any key containing "path" is rejected (matches prior schema.ts).
      return `包含不允许的字段：${key}`;
    }
    const hit = rejectDangerousKeys(
      (value as Record<string, unknown>)[key],
      [...path, key],
      depth + 1,
    );
    if (hit) return hit;
  }
  return null;
}
