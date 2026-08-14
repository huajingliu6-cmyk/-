import {
  AdminConsole,
  type AdminView,
} from "@/auth/ai-admin/AdminConsole";
import { assertSystemAdminPage } from "@/auth/page-guards";

type AdminPageProps = {
  searchParams?: Promise<{
    view?: string | string[];
  }>;
};

const ADMIN_VIEW_ALIASES: Readonly<Record<string, AdminView>> = {
  overview: "overview",
  connections: "connections",
  routes: "routes",
  routing: "routes",
  rules: "rules",
  generations: "generations",
  history: "generations",
  approvals: "approvals",
};

function resolveInitialView(value: string | string[] | undefined): AdminView {
  return typeof value === "string"
    ? (ADMIN_VIEW_ALIASES[value] ?? "overview")
    : "overview";
}

export default async function SystemAdminPage({
  searchParams,
}: AdminPageProps) {
  const user = await assertSystemAdminPage();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <AdminConsole
      user={user}
      initialView={resolveInitialView(resolvedSearchParams?.view)}
    />
  );
}
