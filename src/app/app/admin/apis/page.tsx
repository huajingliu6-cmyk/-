import { AdminConsole } from "@/auth/ai-admin/AdminConsole";
import { assertSystemAdminPage } from "@/auth/page-guards";

/**
 * Stable URL for the API connection management screen.
 *
 * Keep this route as a thin entry point into the same admin console used by
 * `/app/admin?view=connections`; linking directly to `/app/admin/apis` should
 * not require users to know about the console's internal query parameter.
 */
export default async function AdminApisPage() {
  const user = await assertSystemAdminPage();

  return <AdminConsole user={user} initialView="connections" />;
}
