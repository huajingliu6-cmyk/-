"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tldraw, type Editor, type TLEditorSnapshot } from "tldraw";
import "tldraw/tldraw.css";

const AUTOSAVE_MS = 1000;

type Status = "loading" | "saving" | "saved" | "idle";

export default function InfiniteCanvas() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  /** 调用 PUT 接口保存画布 */
  const save = useCallback(async (editor: Editor) => {
    setStatus("saving");
    try {
      const snapshot = editor.getSnapshot();
      const res = await fetch("/api/canvas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: { document: snapshot.document },
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setStatus("saved");
    } catch (e) {
      console.error(e);
      setStatus("idle");
    }
  }, []);

  /** 防抖：停止操作 1 秒后再保存 */
  const debounceSave = useCallback(
    (editor: Editor) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void save(editor);
      }, AUTOSAVE_MS);
    },
    [save],
  );

  const onMount = useCallback(
    (editor: Editor) => {
      let unsub: (() => void) | undefined;
      let cancelled = false;

      void (async () => {
        // 初始加载：GET 接口拉取数据并填充画布
        try {
          const res = await fetch("/api/canvas");
          const data = await res.json();
          if (cancelled) return;
          if (data.snapshot) {
            editor.loadSnapshot(data.snapshot as TLEditorSnapshot);
          }
          setStatus("saved");
        } catch (e) {
          console.error(e);
          if (!cancelled) setStatus("idle");
        }

        if (cancelled) return;

        // 监听用户编辑，触发防抖保存
        unsub = editor.store.listen(() => debounceSave(editor), {
          source: "user",
          scope: "document",
        });
      })();

      return () => {
        cancelled = true;
        unsub?.();
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    },
    [debounceSave],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const label =
    status === "saving"
      ? "正在保存..."
      : status === "loading"
        ? "加载中..."
        : "已保存";

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 顶部浮动状态条 */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-white/95 px-4 py-1.5 text-sm text-zinc-700 shadow ring-1 ring-zinc-200">
        {label}
      </div>
      <Tldraw onMount={onMount} />
    </div>
  );
}
