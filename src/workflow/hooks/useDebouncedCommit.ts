"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 输入框本地草稿 + 防抖写回，避免每个按键都触发 store / 节点重绘。
 */
export function useDebouncedCommit(
  externalValue: string,
  onCommit: (value: string) => void,
  delayMs = 320,
) {
  const [draft, setDraft] = useState(externalValue);
  const draftRef = useRef(draft);
  const committedRef = useRef(externalValue);
  const onCommitRef = useRef(onCommit);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  draftRef.current = draft;
  onCommitRef.current = onCommit;

  useEffect(() => {
    // 外部值变化且非本组件刚提交的结果时，同步草稿（如切模式 / 外部重置）
    if (externalValue === committedRef.current) return;
    if (externalValue === draftRef.current) {
      committedRef.current = externalValue;
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDraft(externalValue);
    draftRef.current = externalValue;
    committedRef.current = externalValue;
  }, [externalValue]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setValue = useCallback(
    (value: string) => {
      setDraft(value);
      draftRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        committedRef.current = value;
        onCommitRef.current(value);
      }, delayMs);
    },
    [delayMs],
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const value = draftRef.current;
    committedRef.current = value;
    onCommitRef.current(value);
    return value;
  }, []);

  return { draft, setValue, flush };
}
