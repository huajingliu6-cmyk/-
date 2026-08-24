"use client";

import { AssetMarketPage } from "@/asset-market/ui/AssetMarketPage";
import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";
import "@/personal/ui/personal-hub-shell.css";

export function AssetMarketShell() {
  return (
    <PersonalSidebarHubLayout
      activeId="asset-market"
      testId="asset-market-shell"
    >
      <AssetMarketPage />
    </PersonalSidebarHubLayout>
  );
}
