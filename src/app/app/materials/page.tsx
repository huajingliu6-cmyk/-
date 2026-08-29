import { redirect } from "next/navigation";
import { APP_ASSET_MARKET_PATH } from "@/shell/nav";

/** Legacy materials-engine URL — no longer a product surface. */
export default function MaterialsRoutePage() {
  redirect(APP_ASSET_MARKET_PATH);
}
