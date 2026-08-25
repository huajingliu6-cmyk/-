"use client";

import { ImagePlus, X } from "lucide-react";
import { useId, useState } from "react";
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
  const baseInputId = useId();
  const [uploadSlot, setUploadSlot] = useState(0);
  const remaining = PERSONAL_IMAGE_MAX_REFERENCES - references.length;
  const inputId = `${baseInputId}-${uploadSlot}`;

  return (
    <div
      className="personal-image-editor__reference-strip"
      data-testid="personal-image-references"
    >
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
        <>
          <input
            key={uploadSlot}
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            className="hub-upload-label__input hub-upload-label__input--linked"
            data-testid="personal-image-reference-input"
            onChange={(event) => {
              const picked = event.target.files;
              if (picked?.length) {
                onAddFiles(picked);
                setUploadSlot((slot) => slot + 1);
              }
            }}
          />
          <label
            htmlFor={inputId}
            className="hub-btn hub-btn--upload hub-upload-label personal-image-reference-slot personal-image-reference-slot--add"
            data-testid="personal-image-reference-btn"
            title={`上传参考图（还可添加 ${remaining} 张）`}
          >
            <ImagePlus size={16} aria-hidden />
            <span className="hub-upload-label__sr">上传参考图</span>
          </label>
        </>
      ) : null}

      <span className="personal-image-editor__reference-hint">
        {references.length}/{PERSONAL_IMAGE_MAX_REFERENCES}
      </span>
    </div>
  );
}
