/**
 * 本机服务端 CLI：撤销 SYSTEM_ADMIN。
 * 用法：npm run auth:revoke-system-admin -- --username <用户名>
 * 禁止撤销最后一个系统管理员。
 */
import { revokeSystemAdminByUsername } from "../src/auth/users";

function readUsername(argv: string[]): string {
  const idx = argv.indexOf("--username");
  if (idx < 0 || !argv[idx + 1]) {
    throw new Error(
      "用法：npm run auth:revoke-system-admin -- --username <用户名>",
    );
  }
  return argv[idx + 1]!.trim();
}

async function main() {
  const username = readUsername(process.argv.slice(2));
  const result = await revokeSystemAdminByUsername(username);
  if (result.alreadyUser) {
    console.log(
      JSON.stringify({
        ok: true,
        alreadyUser: true,
        message: `用户已是普通用户：${result.user.username}`,
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
      alreadyUser: false,
      message: `已撤销系统管理员：${result.user.username}`,
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
