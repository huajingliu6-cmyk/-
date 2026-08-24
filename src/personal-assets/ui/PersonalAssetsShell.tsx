"use client";



import { PersonalAssetsPage } from "@/personal-assets/ui/PersonalAssetsPage";

import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";

import "@/personal/ui/personal-hub-shell.css";



export function PersonalAssetsShell() {

  return (

    <PersonalSidebarHubLayout

      activeId="personal-assets"

      testId="personal-assets-shell"

    >

      <PersonalAssetsPage />

    </PersonalSidebarHubLayout>

  );

}

