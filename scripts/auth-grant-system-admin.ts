/**
 * 本机服务端 CLI：授予 SYSTEM_ADMIN（User.role = admin）。
 * 用法：npm run auth:grant-system-admin -- --username <用户名>
 * 不接受浏览器调用；不输出密码哈希/盐/会话。
 */
import { grantSystemAdminByUsername } from "../src/auth/users";

function readUsername(argv: string[]): string {
  const idx = argv.indexOf("--username");
  if (idx < 0 || !argv[idx + 1]) {
    throw new Error("用法：npm run auth:grant-system-admin -- --username <用户名>");
  }
  return argv[idx + 1]!.trim();
}

async function main() {
  const username = readUsername(process.argv.slice(2));
  const result = await grantSystemAdminByUsername(username);
  if (result.alreadyAdmin) {
    console.log(
      JSON.stringify({
        ok: true,
        alreadyAdmin: true,
        message: `用户已是系统管理员：${result.user.username}`,
        userId: result.user.id,
        username: result.user.username,
        role: result.user.role,
      }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      alreadyAdmin: false,
      message: `已授予系统管理员：${result.user.username}`,
      userId: result.user.id,
      username: result.user.username,
      role: result.user.role,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
