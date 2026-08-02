import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

function backendConfig() {
  const baseUrl = (process.env.GO_BACKEND_INTERNAL_URL ?? '').trim();
  const token = (process.env.INTERNAL_API_TOKEN ?? '').trim();
  if (!baseUrl || !token) {
    throw new Error('Go backend internal URL/token is not configured');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

async function proxy(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    const { baseUrl, token } = backendConfig();
    const target = new URL(`${baseUrl}/${path.map(encodeURIComponent).join('/')}`);
    request.nextUrl.searchParams.forEach((value, key) => {
      target.searchParams.append(key, value);
    });
    const requestId = request.headers.get('x-request-id')?.trim() || randomUUID();
    const headers = new Headers({
      'x-internal-token': token,
      'x-request-id': requestId,
    });
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const response = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
    });
    const responseHeaders = new Headers();
    const responseType = response.headers.get('content-type');
    if (responseType) responseHeaders.set('content-type', responseType);
    responseHeaders.set(
      'x-request-id',
      response.headers.get('x-request-id') || requestId,
    );
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Go backend proxy failed', {
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return NextResponse.json({ error: '内网数据服务不可用' }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
