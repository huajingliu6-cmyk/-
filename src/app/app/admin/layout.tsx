import { assertSystemAdminPage } from "@/auth/page-guards";

export default async function SystemAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertSystemAdminPage();
  return children;
}
