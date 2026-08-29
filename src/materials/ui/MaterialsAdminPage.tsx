"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MATERIAL_GENDER_OPTIONS,
  MATERIAL_THEME_OPTIONS,
  MATERIAL_TYPE_LABELS,
  MATERIAL_TYPES,
  materialMediaUrl,
} from "@/materials/constants";
import type {
  Material,
  MaterialGenderTag,
  MaterialType,
} from "@/materials/types";
import { parseResponseJson } from "@/projects/assets/parse-response-json";
import {
  AppToastHost,
  useAppToasts,
} from "@/shell/AppToast";
import { useAuthUser } from "@/shell/useAuthUser";
import "@/materials/materials.css";

type ModalMode = "create" | "edit";

function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function cleanupOrphanMedia(mediaId: string): Promise<void> {
  try {
    await fetch(`/api/materials/media/${encodeURIComponent(mediaId)}`, {
      method: "DELETE",
    });
  } catch {
    /* best-effort */
  }
}

export function MaterialsAdminPage() {
  const auth = useAuthUser();
  const { toasts, pushToast, dismiss, pause, resume } = useAppToasts();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originalMediaId, setOriginalMediaId] = useState<string | null>(null);
  const [orphanMediaId, setOrphanMediaId] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<{
    mediaId: string;
    url: string;
  } | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<MaterialType>("clothing");
  const [formDescription, setFormDescription] = useState("");
  const [formGenders, setFormGenders] = useState<MaterialGenderTag[]>([]);
  const [formThemes, setFormThemes] = useState<string[]>([]);
  const [formTags, setFormTags] = useState("");

  const loadMaterials = useCallback(async () => {
    const params = new URLSearchParams({ includeDeleted: "1" });
    const res = await fetch(`/api/materials?${params.toString()}`, {
      cache: "no-store",
    });
    const data = await parseResponseJson<{
      materials?: Material[];
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error || "加载素材失败");
    setMaterials(data.materials ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadMaterials();
    } catch (error) {
      pushToast(errorMessage(error, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [loadMaterials, pushToast]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    void refresh();
  }, [auth.status, refresh]);

  const resetForm = () => {
    setUploadPreview(null);
    setFormName("");
    setFormType("clothing");
    setFormDescription("");
    setFormGenders([]);
    setFormThemes([]);
    setFormTags("");
    setEditingId(null);
    setOriginalMediaId(null);
    setOrphanMediaId(null);
    setModalMode("create");
  };

  const closeModal = async () => {
    if (orphanMediaId) {
      await cleanupOrphanMedia(orphanMediaId);
    }
    resetForm();
    setModalOpen(false);
  };

  const openCreateModal = () => {
    resetForm();
    setModalMode("create");
    setModalOpen(true);
  };

  const openEditModal = (material: Material) => {
    resetForm();
    setModalMode("edit");
    setEditingId(material.id);
    setOriginalMediaId(material.mediaId);
    setFormName(material.name);
    setFormType(material.type);
    setFormDescription(material.description);
    setFormGenders(material.genderTags);
    setFormThemes(material.themeTags);
    setFormTags(material.tags.join(", "));
    setUploadPreview({
      mediaId: material.mediaId,
      url: materialMediaUrl(material.mediaId),
    });
    setModalOpen(true);
  };

  const handleUploadFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/materials/upload", {
        method: "POST",
        body: form,
      });
      const data = await parseResponseJson<{
        mediaId?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data.mediaId) {
        throw new Error(data.error || "上传失败");
      }
      if (orphanMediaId && orphanMediaId !== originalMediaId) {
        await cleanupOrphanMedia(orphanMediaId);
      }
      setOrphanMediaId(data.mediaId);
      setUploadPreview({
        mediaId: data.mediaId,
        url: materialMediaUrl(data.mediaId),
      });
      pushToast("图片上传成功，请完善素材信息");
    } catch (error) {
      pushToast(errorMessage(error, "上传失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMaterial = async () => {
    if (!formName.trim()) {
      pushToast("请填写素材名称");
      return;
    }
    if (formGenders.length === 0 && formThemes.length === 0) {
      pushToast("请至少选择一个性别或主题标签，否则无法筛选");
      return;
    }
    setBusy(true);
    try {
      if (modalMode === "edit" && editingId) {
        const res = await fetch(`/api/materials/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: formName,
            type: formType,
            description: formDescription,
            genderTags: formGenders,
            themeTags: formThemes,
            tags: formTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            ...(uploadPreview && uploadPreview.mediaId !== originalMediaId
              ? { mediaId: uploadPreview.mediaId }
              : {}),
          }),
        });
        const data = await parseResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "更新失败");
        pushToast("素材已更新");
      } else {
        if (!uploadPreview) {
          throw new Error("请先上传图片");
        }
        const res = await fetch("/api/materials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: formName,
            type: formType,
            mediaId: uploadPreview.mediaId,
            description: formDescription,
            genderTags: formGenders,
            themeTags: formThemes,
            tags: formTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
        });
        const data = await parseResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "创建失败");
        pushToast("素材已创建");
      }
      setOrphanMediaId(null);
      setModalOpen(false);
      resetForm();
      await refresh();
    } catch (error) {
      pushToast(errorMessage(error, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleSoftDelete = async (material: Material) => {
    if (!window.confirm(`确认下架素材「${material.name}」？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/materials/${material.id}`, {
        method: "DELETE",
      });
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败");
      pushToast("素材已下架");
      await refresh();
    } catch (error) {
      pushToast(errorMessage(error, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  const handleReorderDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const ids = materials.map((item) => item.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setDragId(null);
    setBusy(true);
    try {
      const res = await fetch("/api/materials/reorder", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: next }),
      });
      const data = await parseResponseJson<{
        materials?: Material[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "排序失败");
      if (data.materials) setMaterials(data.materials);
      pushToast("排序已保存");
    } catch (error) {
      pushToast(errorMessage(error, "排序失败"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (auth.status === "loading") {
    return (
      <div className="me-page">
        <div className="me-loading">加载中…</div>
      </div>
    );
  }

  if (auth.status !== "authenticated") {
    return (
      <div className="me-page">
        <div className="me-empty">请先登录</div>
      </div>
    );
  }

  return (
    <div className="me-page">
      <header className="me-header">
        <h1>素材管理</h1>
        <div className="me-header-actions">
          <Link href="/app/asset-market" className="me-btn">
            返回浏览
          </Link>
          <button
            type="button"
            className="me-btn me-btn-primary"
            onClick={openCreateModal}
          >
            上传素材
          </button>
        </div>
      </header>

      <div className="me-admin-body">
        {loading ? (
          <div className="me-loading">加载素材中…</div>
        ) : materials.length === 0 ? (
          <div className="me-empty">暂无素材，点击「上传素材」添加</div>
        ) : (
          <div className="me-grid">
            {materials.map((material) => (
              <div
                key={material.id}
                className={`me-card me-card-admin${dragId === material.id ? " is-dragging" : ""}`}
                draggable
                onDragStart={() => setDragId(material.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void handleReorderDrop(material.id)}
              >
                <div className="me-card-media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={materialMediaUrl(material.mediaId)}
                    alt={material.name}
                  />
                </div>
                <div className="me-card-body">
                  <h3 className="me-card-title">{material.name}</h3>
                  <div className="me-card-meta">
                    {MATERIAL_TYPE_LABELS[material.type]}
                    {material.status === "deleted" ? " · 已下架" : ""}
                    {` · ${material.citeCount} 次引用`}
                  </div>
                  <div className="me-card-actions">
                    <button
                      type="button"
                      className="me-btn"
                      disabled={busy}
                      onClick={() => openEditModal(material)}
                    >
                      编辑
                    </button>
                    {material.status === "active" ? (
                      <button
                        type="button"
                        className="me-btn me-btn-danger"
                        disabled={busy}
                        onClick={() => void handleSoftDelete(material)}
                      >
                        下架
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen ? (
        <div
          className="me-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="me-material-modal-title"
          onClick={() => void closeModal()}
        >
          <div
            className="me-modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="me-modal-header">
              <h2 id="me-material-modal-title">
                {modalMode === "edit" ? "编辑素材" : "上传素材"}
              </h2>
              <button
                type="button"
                className="me-btn"
                onClick={() => void closeModal()}
              >
                关闭
              </button>
            </div>

            <div className="me-admin-form">
              <label>
                图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) =>
                    void handleUploadFile(e.target.files?.[0] ?? null)
                  }
                  disabled={busy}
                />
                {uploadPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="me-preview-thumb"
                    src={uploadPreview.url}
                    alt="预览"
                  />
                ) : null}
              </label>
              <label>
                名称
                <input
                  className="me-input"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </label>
              <label>
                类型
                <select
                  className="me-select"
                  value={formType}
                  onChange={(e) =>
                    setFormType(e.target.value as MaterialType)
                  }
                >
                  {MATERIAL_TYPES.map((id) => (
                    <option key={id} value={id}>
                      {MATERIAL_TYPE_LABELS[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                描述
                <textarea
                  className="me-input"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </label>
              <label>
                自定义标签（逗号分隔）
                <input
                  className="me-input"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                />
              </label>
              <div className="me-chip-row" style={{ gridColumn: "1 / -1" }}>
                <span className="me-chip-label">性别（筛选用，可多选）</span>
                {MATERIAL_GENDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`me-chip${formGenders.includes(opt.id) ? " is-active" : ""}`}
                    onClick={() =>
                      setFormGenders((prev) => toggleValue(prev, opt.id))
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="me-chip-row" style={{ gridColumn: "1 / -1" }}>
                <span className="me-chip-label">主题（筛选用，可多选）</span>
                {MATERIAL_THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`me-chip${formThemes.includes(opt.id) ? " is-active" : ""}`}
                    onClick={() =>
                      setFormThemes((prev) => toggleValue(prev, opt.id))
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="me-hint" style={{ gridColumn: "1 / -1" }}>
                至少选择一个性别或主题。「不限」只会在用户勾选「不限」时出现，不会匹配男装/女装等具体筛选。
              </p>
              <div className="me-admin-form-actions">
                <button
                  type="button"
                  className="me-btn me-btn-primary"
                  disabled={busy}
                  onClick={() => void handleSaveMaterial()}
                >
                  {modalMode === "edit" ? "保存修改" : "创建素材"}
                </button>
                <button
                  type="button"
                  className="me-btn"
                  disabled={busy}
                  onClick={() => void closeModal()}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AppToastHost
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pause}
        onResume={resume}
      />
    </div>
  );
}
