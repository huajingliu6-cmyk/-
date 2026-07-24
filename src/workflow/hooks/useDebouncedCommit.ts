"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 输入框本地草稿 + 防抖写回，避免每个按键都触发 store / 节点重绘。
 * 外部值变化（切节点 / 外部重置）通过渲染期状态调整同步，不在 effect 里复制 props。
 */
export function useDebouncedCommit(
  externalValue: string,
  onCommit: (value: string) => void,
  delayMs = 320,
) {
  const [draft, setDraft] = useState(externalValue);
  const [committed, setCommitted] = useState(externalValue);
  const [prevExternal, setPrevExternal] = useState(externalValue);
  const [syncVersion, setSyncVersion] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  const syncVersionRef = useRef(syncVersion);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    syncVersionRef.current = syncVersion;
  }, [syncVersion]);

  if (externalValue !== prevExternal) {
    setPrevExternal(externalValue);
    if (externalValue !== committed) {
      setDraft(externalValue);
      setCommitted(externalValue);
      setSyncVersion((v) => v + 1);
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setValue = useCallback(
    (value: string) => {
      setDraft(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      const scheduledVersion = syncVersionRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (syncVersionRef.current !== scheduledVersion) return;
        setCommitted(value);
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
    setCommitted(draft);
    onCommitRef.current(draft);
    return draft;
  }, [draft]);

  return { draft, setValue, flush };
}
