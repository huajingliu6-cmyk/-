export const OPEN_POINTS_CENTER_EVENT = "shell:open-points-center";

export type OpenPointsCenterDetail = {
  tab?: "history" | "recharge" | "records";
};

export function openPointsCenter(detail?: OpenPointsCenterDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenPointsCenterDetail>(OPEN_POINTS_CENTER_EVENT, {
      detail: detail ?? { tab: "recharge" },
    }),
  );
}
