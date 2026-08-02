type Props = {
  title: string;
  description?: string;
};

/** 模块尚未落地时的规范空状态（非假业务数据） */
export function ModulePlaceholder({ title, description }: Props) {
  return (
    <div className="flex min-h-[calc(100svh-var(--shell-header-h,68px))] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-lg text-violet-200">
          …
        </div>
        <h1 className="text-lg font-semibold text-white/90">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/45">
          {description ?? "功能建设中，后续将接入真实业务能力。"}
        </p>
      </div>
    </div>
  );
}
