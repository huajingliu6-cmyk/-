"use client";

/** Shared placeholder for board slots that are being edited before media exists. */
export function LibraryAssetEditingPlaceholder({
  testId = "library-asset-editing-placeholder",
}: {
  testId?: string;
}) {
  return (
    <span
      className="character-look-card__editing"
      data-testid={testId}
      aria-label="正在编辑中"
    >
      <span className="character-look-card__editing-text">正在编辑中</span>
    </span>
  );
}
