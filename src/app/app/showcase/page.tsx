import { redirect } from "next/navigation";
import { APP_ASSET_MARKET_PATH } from "@/shell/nav";

/** Legacy showcase path → public asset market. */
export default function ShowcaseRedirectPage() {
  redirect(APP_ASSET_MARKET_PATH);
}
