import { redirect } from "next/navigation";

/** Legacy API admin URL → unified system config API view. */
export default function AdminApisPage() {
  redirect("/app/admin?view=api");
}
