import type { ProjectAssetType } from "@/projects/assets/types";

const STRING_FIELDS = new Set([
  "name",
  "role",
  "description",
  "appearance",
  "clothing",
  "age",
  "gender",
  "sceneType",
  "timeOfDay",
  "location",
  "style",
  "propType",
  "usage",
  "duration",
  "source",
]);

const NULLABLE_STRING_FIELDS = new Set([
  "voiceId",
  "voiceName",
  "voiceStyle",
  "imageFileName",
  "imageMimeType",
  "fileName",
  "mimeType",
  "primaryMediaId",
]);

const STRING_ARRAY_FIELDS = new Set([
  "approvedMediaIds",
  "historyMediaIds",
  "lookMediaIds",
]);

const RECORD_FIELDS = new Set([
  "mediaVoices",
  "mediaVideoRefSafety",
  "mediaDisplayNames",
  "mediaLastUsedAt",
  "mediaLookProvenance",
]);

const OBJECT_OR_NULL_FIELDS = new Set([
  "approvalProvenance",
  "videoRefSafety",
]);

const STATUS_VALUES = new Set(["draft", "completed", "pending"]);

const AUDIO_TYPES = new Set(["music", "sfx", "narration", "voice"]);

const ENTITY_FIELDS: Record<ProjectAssetType, Set<string>> = {
  character: new Set([
    "name",
    "role",
    "description",
    "appearance",
    "clothing",
    "age",
    "gender",
    "voiceId",
    "voiceName",
    "voiceStyle",
    "imageFileName",
    "imageMimeType",
    "status",
    "approvedMediaIds",
    "primaryMediaId",
    "historyMediaIds",
    "lookMediaIds",
    "approvalProvenance",
    "mediaVideoRefSafety",
    "videoRefSafety",
    "mediaDisplayNames",
    "mediaLastUsedAt",
    "mediaLookProvenance",
    "mediaVoices",
  ]),
  scene: new Set([
    "name",
    "sceneType",
    "description",
    "timeOfDay",
    "location",
    "style",
    "imageFileName",
    "imageMimeType",
    "status",
    "approvedMediaIds",
    "primaryMediaId",
    "approvalProvenance",
    "videoRefSafety",
  ]),
  prop: new Set([
    "name",
    "propType",
    "usage",
    "description",
    "imageFileName",
    "imageMimeType",
    "status",
    "approvedMediaIds",
    "primaryMediaId",
    "approvalProvenance",
    "videoRefSafety",
  ]),
  audio: new Set([
    "name",
    "type",
    "duration",
    "source",
    "fileName",
    "mimeType",
    "status",
  ]),
};

export function isConflictResolvableField(
  entityType: ProjectAssetType,
  field: string,
): boolean {
  return ENTITY_FIELDS[entityType]?.has(field) === true;
}

export function validateConflictFieldValue(
  entityType: ProjectAssetType,
  field: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isConflictResolvableField(entityType, field)) {
    return { ok: false, error: `字段 ${field} 不允许手工解决` };
  }
  if (field === "status") {
    return typeof value === "string" && STATUS_VALUES.has(value)
      ? { ok: true }
      : { ok: false, error: "status 必须是 draft | completed | pending" };
  }
  if (field === "type" && entityType === "audio") {
    return typeof value === "string" && AUDIO_TYPES.has(value)
      ? { ok: true }
      : { ok: false, error: "audio.type 必须是 music | sfx | narration | voice" };
  }
  if (STRING_FIELDS.has(field)) {
    return typeof value === "string"
      ? { ok: true }
      : { ok: false, error: `${field} 必须是字符串` };
  }
  if (NULLABLE_STRING_FIELDS.has(field)) {
    return value === null || typeof value === "string"
      ? { ok: true }
      : { ok: false, error: `${field} 必须是字符串或 null` };
  }
  if (STRING_ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return { ok: false, error: `${field} 必须是字符串数组` };
    }
    return { ok: true };
  }
  if (RECORD_FIELDS.has(field) || OBJECT_OR_NULL_FIELDS.has(field)) {
    if (value === null) return { ok: true };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: `${field} 必须是对象或 null` };
    }
    return { ok: true };
  }
  return { ok: false, error: `${field} 不受支持` };
}
