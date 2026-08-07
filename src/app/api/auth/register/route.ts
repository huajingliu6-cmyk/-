import { NextResponse } from "next/server";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/auth/session";
import { validateRegistrationInput } from "@/auth/registration";
import { createUser } from "@/auth/users";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      confirmPassword?: string;
      displayName?: string;
    };
    const input = {
      username: body.username ?? "",
      password: body.password ?? "",
      confirmPassword: body.confirmPassword ?? "",
      displayName: body.displayName,
    };
    const validationError = validateRegistrationInput(input);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const user = await createUser({
      username: input.username,
      password: input.password,
      displayName: input.displayName,
    });
    const token = await createSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    });
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(undefined, request));
    return response;
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "用户服务暂时不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "注册失败，请稍后重试";
    const status = message.includes("已存在") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
