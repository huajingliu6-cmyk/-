export type RegistrationInput = {
  username: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
};

export function validateRegistrationInput(input: RegistrationInput): string | null {
  const username = input.username.trim();
  if (username.length < 2) return "用户名至少需要 2 个字符";
  if (username.length > 32) return "用户名不能超过 32 个字符";
  if (!/^[\p{L}\p{N}_.-]+$/u.test(username)) {
    return "用户名只能包含中文、字母、数字、下划线、点或短横线";
  }
  if (input.password.length < 6) return "密码至少需要 6 个字符";
  if (input.password.length > 128) return "密码不能超过 128 个字符";
  if (input.password !== input.confirmPassword) return "两次输入的密码不一致";
  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length > 40) return "昵称不能超过 40 个字符";
  return null;
}
