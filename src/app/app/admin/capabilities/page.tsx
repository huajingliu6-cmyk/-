import { redirect } from "next/navigation";

/** Legacy standalone task-rules route → API connections (embedded rules). */
export default function SystemAdminCapabilitiesPage() {
  redirect("/app/admin?view=connections");
}
