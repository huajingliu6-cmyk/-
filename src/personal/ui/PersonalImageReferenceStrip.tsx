"use client";

import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { PERSONAL_IMAGE_MAX_REFERENCES } from "@/personal/image-generation/constants";
import type { PersonalReferenceImage } from "@/personal/ui/personal-image-utils";

type PersonalImageReferenceStripProps = {
  references: PersonalReferenceImage[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemove: (referenceId: string) => void;
};

export function PersonalImageReferenceStrip({
  references,
  onAddFiles,
  onRemove,
}: PersonalImageReferenceStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const remaining = PERSONAL_IMAGE_MAX_REFERENCES - references.length;

  return (
    <div
      className="personal-image-editor__reference-strip"
      data-testid="personal-image-references"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        data-testid="personal-image-reference-input"
        onChange={(event) => {
          if (event.target.files?.length) {
            onAddFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />

      {references.map((reference) => (
        <div key={reference.id} className="hub-ref-thumb">
          <img src={reference.previewUrl} alt="参考图" />
          <button
            type="button"
            className="hub-ref-thumb__remove"
            aria-label="移除参考图"
            onClick={() => onRemove(reference.id)}
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {remaining > 0 ? (
        <button
          type="button"
          className="hub-btn hub-btn--upload personal-image-reference-slot personal-image-reference-slot--add"
          data-testid="personal-image-reference-btn"
          title={`上传参考图（还可添加 ${remaining} 张）`}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} aria-hidden />
        </button>
      ) : null}

      <span className="personal-image-editor__reference-hint">
        {references.length}/{PERSONAL_IMAGE_MAX_REFERENCES}
      </span>
    </div>
  );
}
