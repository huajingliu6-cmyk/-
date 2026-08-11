"use client";

import { useId, type ReactNode } from "react";

export type AssetBasicInfoField = {
  key: string;
  label: ReactNode;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
};

type Props = {
  fields: AssetBasicInfoField[];
  title?: string;
  /** Compact two-column controls layout (library detail). */
  compact?: boolean;
  showTitle?: boolean;
};

/** Basic info fields — compact 2-col for library, or vertical short inputs. */
export function AssetBasicInfo({
  fields,
  title = "基础信息",
  compact = false,
  showTitle = !compact,
}: Props) {
  return (
    <div
      className={`asset-basic-info-section${
        compact ? " asset-basic-info-section--compact" : ""
      }`}
    >
      {showTitle ? <h3>{title}</h3> : null}
      <div
        className={
          compact
            ? "asset-controls__basic-grid asset-basic-info asset-basic-info--grid"
            : "asset-basic-info"
        }
      >
        {fields.map((field) => {
          const { key: fieldKey, ...rest } = field;
          return (
            <AssetBasicInfoShortField
              key={fieldKey}
              compact={compact}
              {...rest}
            />
          );
        })}
      </div>
    </div>
  );
}

export function AssetBasicInfoShortField({
  label,
  value,
  disabled = false,
  placeholder,
  onChange,
  compact = false,
}: Omit<AssetBasicInfoField, "key"> & { compact?: boolean }) {
  const id = useId();
  return (
    <label className="asset-basic-info__field" htmlFor={id}>
      <span className="asset-basic-info__label">{label}</span>
      <input
        id={id}
        className={`amw-input asset-basic-info__short-input${
          compact ? " asset-basic-info__short-input--fluid" : ""
        }`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
