import { NextResponse } from "next/server";
import { decodeToken, toUI, type InternalThread } from "../../_lib/demo";

export async function GET(req: Request) {
  const token = req.headers.get("x-demo-token") || "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  let thread: InternalThread;
  try {
    thread = decodeToken<InternalThread>(token);
  } catch {
    return NextResponse.json({ error: "Bad token" }, { status: 401 });
  }

  const ui = toUI(thread, new Date());
  return NextResponse.json({ ...ui, token }, { status: 200 });
}
