import { Suspense } from "react";
import { MaterialsAdminPage } from "@/materials/ui/MaterialsAdminPage";
import "@/materials/materials.css";

export default function MaterialsAdminRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="me-page">
          <div className="me-loading">加载中…</div>
        </div>
      }
    >
      <MaterialsAdminPage />
    </Suspense>
  );
}
