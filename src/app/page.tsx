"use client";

import { useEffect, useState } from "react";
import InfiniteCanvas from "@/components/InfiniteCanvas";

export default function Home() {
  const [ready, setReady] = useState(false);

  // tldraw 只能在浏览器里运行，等客户端挂载后再渲染
  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-white text-zinc-500">
        画布加载中...
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden">
      <InfiniteCanvas />
    </main>
  );
}
