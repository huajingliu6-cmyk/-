/** 登录后门户根：空白内容区，不挂载任何业务模块 */
export default function AppPortalPage() {
  return (
    <div
      className="shell-portal-blank relative min-h-[calc(100svh-var(--shell-header-h,68px))] w-full"
      aria-label="应用门户"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 40%, rgba(124,58,237,0.08), transparent 60%), radial-gradient(ellipse 40% 35% at 70% 70%, rgba(56,189,248,0.05), transparent 55%), #070811",
        }}
        aria-hidden
      />
    </div>
  );
}
