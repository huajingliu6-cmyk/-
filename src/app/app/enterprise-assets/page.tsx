import { redirect } from "next/navigation";
import { APP_ASSET_MARKET_PATH } from "@/asset-market/constants";

export default function EnterpriseAssetsRedirectPage() {
  redirect(APP_ASSET_MARKET_PATH);
}
