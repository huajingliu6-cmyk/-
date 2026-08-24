"use client";



import { Suspense, useCallback, useEffect, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import type { AppSidebarView } from "@/shell/AppSidebar";

import { PersonalImageWorkspace } from "@/personal/ui/PersonalImageWorkspace";

import { PersonalVideoWorkspace } from "@/personal/ui/PersonalVideoWorkspace";

import { PersonalSidebarHubLayout } from "@/personal/ui/PersonalSidebarHubLayout";

import {

  PERSONAL_HUB_QUERY_KEY,

  parsePersonalHubView,

  personalHubHref,

} from "@/personal/ui/personal-hub-nav";

import "@/personal/ui/personal-hub-shell.css";



function PersonalHubShellBody() {

  const router = useRouter();

  const searchParams = useSearchParams();

  const hubParam = searchParams.get(PERSONAL_HUB_QUERY_KEY);

  const [view, setView] = useState<AppSidebarView>(() =>

    parsePersonalHubView(hubParam),

  );



  useEffect(() => {

    setView(parsePersonalHubView(hubParam));

  }, [hubParam]);



  const handleSelectView = useCallback(

    (next: AppSidebarView) => {

      setView(next);

      router.replace(personalHubHref(next), { scroll: false });

    },

    [router],

  );



  return (

    <PersonalSidebarHubLayout activeId={view} onSelectView={handleSelectView}>

      <div

        className="personal-hub-shell__panel"

        hidden={view !== "personal-image"}

        aria-hidden={view !== "personal-image"}

      >

        <PersonalImageWorkspace />

      </div>

      <div

        className="personal-hub-shell__panel"

        hidden={view !== "personal-video"}

        aria-hidden={view !== "personal-video"}

      >

        <PersonalVideoWorkspace />

      </div>

    </PersonalSidebarHubLayout>

  );

}



export function PersonalHubShell() {

  return (

    <Suspense fallback={null}>

      <PersonalHubShellBody />

    </Suspense>

  );

}

