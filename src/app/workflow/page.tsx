import { redirect } from "next/navigation";

/** 旧并行入口已并入主页，避免用户回到白板 */
export default function WorkflowRedirectPage() {
  redirect("/");
}
