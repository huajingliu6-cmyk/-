import {
  AdminConsole,
} from "@/auth/ai-admin/AdminConsole";
import { resolveAdminInitialView } from "@/auth/ai-admin/admin-view";
import { assertSystemAdminPage } from "@/auth/page-guards";

type AdminPageProps = {
  searchParams?: Promise<{
    view?: string | string[];
  }>;
};

export default async function SystemAdminPage({
  searchParams,
}: AdminPageProps) {
  const user = await assertSystemAdminPage();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <AdminConsole
      user={user}
      initialView={resolveAdminInitialView(resolvedSearchParams?.view)}
    />
  );
}
