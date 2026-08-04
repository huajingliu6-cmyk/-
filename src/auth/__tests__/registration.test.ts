import { describe, expect, it } from "vitest";
import { validateRegistrationInput } from "@/auth/registration";
import { authenticateUser, createUser } from "@/auth/users";

describe("registration", () => {
  it("validates account input", () => {
    expect(
      validateRegistrationInput({
        username: "a",
        password: "secret1",
        confirmPassword: "secret1",
      }),
    ).toBe("用户名至少需要 2 个字符");

    expect(
      validateRegistrationInput({
        username: "valid-user",
        password: "secret1",
        confirmPassword: "secret2",
      }),
    ).toBe("两次输入的密码不一致");

    expect(
      validateRegistrationInput({
        username: "光合_user-01",
        password: "secret1",
        confirmPassword: "secret1",
        displayName: "光合创作者",
      }),
    ).toBeNull();
  });

  it("creates a normal user that can authenticate", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const username = `creator_${suffix}`;
    const user = await createUser({
      username,
      password: "Secret-123",
      displayName: "新创作者",
    });

    expect(user.username).toBe(username);
    expect(user.displayName).toBe("新创作者");
    expect(user.role).toBe("user");
    await expect(authenticateUser(username, "Secret-123")).resolves.toMatchObject({
      id: user.id,
      role: "user",
    });
    await expect(authenticateUser(username, "wrong-password")).resolves.toBeNull();
  });

  it("rejects duplicate usernames case-insensitively", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const username = `Member_${suffix}`;
    await createUser({ username, password: "Secret-123" });

    await expect(
      createUser({ username: username.toLowerCase(), password: "Secret-456" }),
    ).rejects.toThrow("用户名已存在");
  });
});
