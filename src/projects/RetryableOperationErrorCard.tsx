"use client";

export function RetryableOperationErrorCard({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="retryable-operation-error-card"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      <p className="font-medium">操作未完成</p>
      <p className="mt-1 text-amber-900">
        本次操作可能因网络中断或服务重启而失败，请检查当前数据状态后重新操作。
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded bg-amber-900 px-2 py-1 text-xs text-white"
        >
          重新操作
        </button>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-amber-400 px-2 py-1 text-xs"
          >
            关闭
          </button>
        ) : null}
      </div>
    </div>
  );
}
