import { AuthenticatedAppShell } from "@/shell/AuthenticatedAppShell";

export default function AppSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}
