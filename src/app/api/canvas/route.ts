import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const CANVAS_FILE = path.join(process.cwd(), "data", "canvases", "default.json");

/** 文件不存在时返回的初始空画布 */
const EMPTY_CANVAS = {
  snapshot: null,
  updatedAt: null,
};

async function ensureDir() {
  await fs.mkdir(path.dirname(CANVAS_FILE), { recursive: true });
}

/** GET：读取 data/canvases/default.json；不存在则返回空画布 */
export async function GET() {
  try {
    await ensureDir();
    const raw = await fs.readFile(CANVAS_FILE, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(EMPTY_CANVAS);
  }
}

/** PUT：接收画布 JSON 并写入 data/canvases/default.json */
export async function PUT(request: Request) {
  try {
    await ensureDir();
    const body = await request.json();
    const data = {
      snapshot: body.snapshot ?? null,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(CANVAS_FILE, JSON.stringify(data, null, 2), "utf-8");
    return NextResponse.json(data);
  } catch (error) {
    console.error("保存画布失败:", error);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
