/**
 * 页面注册未保存离开检查。
 * 返回 true = 允许离开；false = 已取消。
 * 页面可在内部弹出统一 ConfirmLeaveDialog 后再 resolve。
 */
export type UnsavedLeaveHandler = () => boolean | Promise<boolean>;

let handler: UnsavedLeaveHandler | null = null;

export function registerUnsavedLeaveHandler(
  next: UnsavedLeaveHandler | null,
): void {
  handler = next;
}

export async function confirmUnsavedLeaveIfNeeded(): Promise<boolean> {
  if (!handler) return true;
  return handler();
}
