"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import {
  defaultMediaIdForAsset,
  resolvePickerThumbUrl,
} from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import type { SceneCharacterPlacement } from "@/projects/storyboard/types";

type Props = {
  open: boolean;
  projectId: string;
  sceneMediaId: string | null;
  characters: PickerAsset[];
  initialPlacements: SceneCharacterPlacement[];
  onCancel: () => void;
  onSave: (placements: SceneCharacterPlacement[]) => Promise<void> | void;
};

type DragState = {
  characterAssetId: string;
  pointerId: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function SceneCharacterPlacementEditor({
  open,
  projectId,
  sceneMediaId,
  characters,
  initialPlacements,
  onCancel,
  onSave,
}: Props) {
  const [placements, setPlacements] = useState<SceneCharacterPlacement[]>(
    () => initialPlacements,
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    () => characters[0]?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const sceneUrl = useMemo(() => {
    if (!sceneMediaId) return null;
    return getProjectAssetImageUrl(projectId, sceneMediaId, {
      revision: sceneMediaId,
    });
  }, [projectId, sceneMediaId]);

  const pointFromEvent = useCallback((clientX: number, clientY: number) => {
    const img = imageRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: clamp01(localX / rect.width),
      y: clamp01(localY / rect.height),
    };
  }, []);

  const upsertPlacement = useCallback(
    (characterAssetId: string, x: number, y: number) => {
      setPlacements((prev) => {
        const next = prev.filter((p) => p.characterAssetId !== characterAssetId);
        next.push({ characterAssetId, x, y });
        return next;
      });
    },
    [],
  );

  const handleImageClick = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      if (!selectedCharacterId) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      upsertPlacement(selectedCharacterId, point.x, point.y);
    },
    [pointFromEvent, selectedCharacterId, upsertPlacement],
  );

  const handleMarkerPointerDown = useCallback(
    (characterAssetId: string, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        characterAssetId,
        pointerId: event.pointerId,
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleMarkerPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = pointFromEvent(event.clientX, event.clientY);
      if (!point) return;
      upsertPlacement(drag.characterAssetId, point.x, point.y);
    },
    [pointFromEvent, upsertPlacement],
  );

  const handleMarkerPointerUp = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
  }, []);

  if (!open) return null;

  return (
    <div
      className="aie-placement-backdrop"
      role="presentation"
      data-testid="scene-placement-editor"
      onClick={onCancel}
    >
      <div
        className="aie-placement-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="人物位置"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ead-modal__head">
          <h2>人物位置</h2>
          <button type="button" className="amw-btn" onClick={onCancel}>
            取消
          </button>
        </header>

        {characters.length === 0 ? (
          <p className="ead-muted" data-testid="scene-placement-empty">
            请先为当前镜头添加人物素材
          </p>
        ) : (
          <div className="aie-placement-layout">
            <div className="aie-placement-characters">
              {characters.map((character) => {
                const active = character.id === selectedCharacterId;
                const thumb =
                  resolvePickerThumbUrl(
                    character,
                    defaultMediaIdForAsset(character),
                  ) ?? null;
                return (
                  <button
                    key={character.id}
                    type="button"
                    className={`aie-placement-character${active ? " is-active" : ""}`}
                    onClick={() => setSelectedCharacterId(character.id)}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" />
                    ) : (
                      <span>人</span>
                    )}
                    <span>{character.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="aie-placement-stage">
              {sceneUrl ? (
                <div className="aie-placement-stage__frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imageRef}
                    src={sceneUrl}
                    alt="场景参考"
                    className="aie-placement-stage__image"
                    onClick={handleImageClick}
                    draggable={false}
                  />
                  {placements.map((placement) => {
                    const character = characters.find(
                      (c) => c.id === placement.characterAssetId,
                    );
                    if (!character) return null;
                    return (
                      <button
                        key={placement.characterAssetId}
                        type="button"
                        className="aie-placement-marker"
                        style={{
                          left: `${placement.x * 100}%`,
                          top: `${placement.y * 100}%`,
                        }}
                        title={character.name}
                        onPointerDown={(e) =>
                          handleMarkerPointerDown(placement.characterAssetId, e)
                        }
                        onPointerMove={handleMarkerPointerMove}
                        onPointerUp={handleMarkerPointerUp}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {character.name.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="ead-muted">缺少场景预览图</p>
              )}
            </div>

            <div className="aie-placement-list">
              {placements.map((placement) => {
                const character = characters.find(
                  (c) => c.id === placement.characterAssetId,
                );
                return (
                  <div
                    key={placement.characterAssetId}
                    className="aie-placement-list__row"
                  >
                    <span>
                      {character?.name ?? placement.characterAssetId} · x=
                      {placement.x.toFixed(2)} y={placement.y.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      className="amw-btn"
                      onClick={() =>
                        setPlacements((prev) =>
                          prev.filter(
                            (p) =>
                              p.characterAssetId !== placement.characterAssetId,
                          ),
                        )
                      }
                    >
                      删除
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error ? (
          <p className="ead-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="ead-image-edit-panel__foot">
          <button type="button" className="amw-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            data-testid="scene-placement-save"
            disabled={saving || characters.length === 0}
            onClick={() => {
              void (async () => {
                setSaving(true);
                setError("");
                try {
                  await onSave(placements);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "保存失败");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            {saving ? "保存中…" : "保存位置"}
          </button>
        </footer>
      </div>
    </div>
  );
}
