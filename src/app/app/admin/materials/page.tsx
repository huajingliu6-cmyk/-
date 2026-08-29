import { redirect } from "next/navigation";

/** Legacy materials admin URL → unified system config materials view. */
export default function MaterialsAdminRoutePage() {
  redirect("/app/admin?view=materials");
}
