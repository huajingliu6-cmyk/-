"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import { postLibrarySd2Precheck } from "@/projects/assets/post-library-sd2-precheck";
import type { CharacterAppearance, CharacterAsset } from "@/projects/assets/types";

export type CreateCharacterLookResult = {
  character: CharacterAsset;
  appearance: CharacterAppearance;
  mode: "upload" | "generate";
  /** Present after upload+confirm path. */
  mediaId?: string;
};

type Props = {
  open: boolean;
  projectId: string;
  context: "management" | "workspace";
  character: CharacterAsset;
  initialPrompt?: string;
  busy?: boolean;
  onClose: () => void;
  onCreated: (result: CreateCharacterLookResult) => void | Promise<void>;
};

type CreateMode = "upload" | "generate";

export function CreateCharacterLookDialog({
  open,
  projectId,
  context,
  character,
  initialPrompt = "",
  busy = false,
  onClose,
  onCreated,
}: Props) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CreateMode>("generate");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setMode("generate");
    setPrompt(initialPrompt);
    setFile(null);
    setSubmitting(false);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, character.id, initialPrompt]);

  if (!open || typeof document === "undefined") return null;

  const apiRoot =
    context === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
  const disabled = submitting || busy;

  const handleSubmit = async () => {
    if (disabled) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写造型名称");
      return;
    }
    if (mode === "upload" && !file) {
      setError("请选择要上传的造型图片");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const createRes = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/media`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create-appearance",
            displayName: trimmedName,
            promptOverride: prompt.trim(),
          }),
        },
      );
      const created = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
        appearance?: CharacterAppearance;
      }>(createRes);
      if (!createRes.ok || !created?.character || !created.appearance) {
        throw new Error(created?.error ?? "创建造型失败");
      }

      if (mode === "generate") {
        await onCreated({
          character: created.character,
          appearance: created.appearance,
          mode: "generate",
        });
        return;
      }

      const form = new FormData();
      form.set("file", file!);
      const uploadRes = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/replace-primary`,
        { method: "POST", credentials: "include", body: form },
      );
      const uploaded = await parseResponseJson<{
        error?: string;
        candidateMediaId?: string;
      }>(uploadRes);
      if (!uploadRes.ok || !uploaded?.candidateMediaId) {
        throw new Error(uploaded?.error ?? "上传失败");
      }

      const precheck = await postLibrarySd2Precheck({
        apiRoot,
        assetId: character.id,
        mediaId: uploaded.candidateMediaId,
      });
      if (!precheck.ok) {
        throw new Error(precheck.error ?? "人物校验未通过");
      }

      const confirmRes = await fetch(
        `${apiRoot}/assets-draft/characters/${encodeURIComponent(character.id)}/media`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "confirm-appearance",
            appearanceId: created.appearance.id,
            mediaId: uploaded.candidateMediaId,
          }),
        },
      );
      const confirmed = await parseResponseJson<{
        error?: string;
        character?: CharacterAsset;
        appearance?: CharacterAppearance;
      }>(confirmRes);
      if (!confirmRes.ok || !confirmed?.character) {
        throw new Error(confirmed?.error ?? "确认造型图片失败");
      }

      await onCreated({
        character: confirmed.character,
        appearance:
          confirmed.appearance ??
          created.appearance,
        mode: "upload",
        mediaId: uploaded.candidateMediaId,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建造型失败");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="character-create-look-dialog"
      data-testid="character-create-look-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="character-create-look-dialog__panel">
        <header className="character-create-look-dialog__head">
          <h2 id={titleId}>新增人物造型</h2>
          <button
            type="button"
            className="amw-btn"
            data-testid="character-create-look-close"
            disabled={disabled}
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <label className="amw-field">
          <span>造型名称</span>
          <input
            className="amw-input"
            data-testid="character-create-look-name"
            placeholder="例如：少年时期 / 受伤状态 / 宴会礼服"
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="character-create-look-dialog__modes">
          <span className="character-create-look-dialog__label">创建方式</span>
          <div className="character-create-look-dialog__mode-row">
            <button
              type="button"
              className={`amw-btn${mode === "upload" ? " amw-btn-primary" : ""}`}
              data-testid="character-create-look-mode-upload"
              aria-pressed={mode === "upload"}
              disabled={disabled}
              onClick={() => setMode("upload")}
            >
              上传文件
            </button>
            <button
              type="button"
              className={`amw-btn${mode === "generate" ? " amw-btn-primary" : ""}`}
              data-testid="character-create-look-mode-generate"
              aria-pressed={mode === "generate"}
              disabled={disabled}
              onClick={() => setMode("generate")}
            >
              生成造型
            </button>
          </div>
        </div>

        <p className="amw-hint" data-testid="character-create-look-inherit-hint">
          继承说明：默认继承主形象的人脸、人物身份和基础体型。可通过提示词修改服装、年龄、伤病、发型、妆容和状态。
        </p>

        <label className="amw-field">
          <span>造型提示词</span>
          <textarea
            className="amw-textarea"
            data-testid="character-create-look-prompt"
            rows={6}
            value={prompt}
            disabled={disabled}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="可修改服装、年龄、伤病、发型、妆容和状态"
          />
        </label>

        {mode === "upload" ? (
          <div className="character-create-look-dialog__upload">
            <button
              type="button"
              className="amw-btn"
              data-testid="character-create-look-pick-file"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? "重新选择文件" : "选择图片文件"}
            </button>
            <span className="amw-muted" data-testid="character-create-look-file-name">
              {file ? file.name : "尚未选择文件"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              className="amw-file-input"
              data-testid="character-create-look-file"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
              }}
            />
          </div>
        ) : (
          <p className="amw-hint">
            点击「创建造型」后进入生成面板。生成结果会自动写入该造型历史并显示在预览中（不会替换主形象）。
          </p>
        )}

        {error ? (
          <p className="amw-field-error" role="alert" data-testid="character-create-look-error">
            {error}
          </p>
        ) : null}

        <footer className="character-create-look-dialog__foot">
          <button
            type="button"
            className="amw-btn"
            data-testid="character-create-look-cancel"
            disabled={disabled}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            data-testid="character-create-look-submit"
            disabled={disabled}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "创建中…" : "创建造型"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
