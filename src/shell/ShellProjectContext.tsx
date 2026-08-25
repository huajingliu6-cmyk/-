"use client";

type Props = {
  projectName: string | null;
};

export function ShellProjectContext({ projectName }: Props) {
  const resolved = projectName?.trim();
  const isLoading = resolved == null;
  const label = resolved || "当前项目";

  return (
    <div
      className="shell-project-context"
      data-testid="shell-project-context"
    >
      <span
        className={`shell-project-context__name${
          isLoading ? " shell-project-context__name--placeholder" : ""
        }`}
        title={isLoading ? undefined : label}
        aria-label={`当前项目：${label}`}
      >
        {label}
      </span>
    </div>
  );
}
