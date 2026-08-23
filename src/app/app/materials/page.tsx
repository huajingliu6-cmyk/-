import { Suspense } from "react";
import { MaterialsPage } from "@/materials/ui/MaterialsPage";
import "@/materials/materials.css";

export default function MaterialsRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="me-page">
          <div className="me-loading">加载中…</div>
        </div>
      }
    >
      <MaterialsPage />
    </Suspense>
  );
}
