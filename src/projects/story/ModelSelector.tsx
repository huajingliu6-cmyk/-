"use client";

import { GlassSelect } from "@/projects/story/GlassSelect";
import type { TextModelOption } from "@/projects/story/types";

type Props = {
  options: TextModelOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
};

export function ModelSelector({
  options,
  value,
  onChange,
  disabled = false,
  id,
  label = "模型选择",
}: Props) {
  return (
    <GlassSelect
      id={id}
      label={label}
      disabled={disabled}
      value={value}
      onChange={onChange}
      placeholder="选择模型"
      options={options.map((o) => ({
        id: o.id,
        label: o.name,
        description: o.description,
      }))}
    />
  );
}
