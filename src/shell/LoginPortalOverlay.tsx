"use client";

type Props = {
  phase: "idle" | "exit" | "enter";
};

export function LoginPortalOverlay({ phase }: Props) {
  if (phase === "idle") return null;

  return (
    <div
      className={`login-portal is-active ${
        phase === "exit" ? "is-exit" : "is-enter"
      }`}
      aria-hidden
    >
      <div className="login-portal__stage">
        <div className="login-portal__ring" />
        <div className="login-portal__ring login-portal__ring--2" />
        <div className="login-portal__ring login-portal__ring--3" />
        <div className="login-portal__ring login-portal__ring--4" />
        <div className="login-portal__vignette" />
      </div>
    </div>
  );
}
