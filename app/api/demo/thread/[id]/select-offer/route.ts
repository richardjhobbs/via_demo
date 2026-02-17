import { NextResponse } from "next/server";
import { decodeToken, encodeToken, selectOfferInThread, toUI, type InternalThread } from "../../../_lib/demo";

export async function POST(req: Request) {
  const token = req.headers.get("x-demo-token") || "";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const offerId = (body?.offerId ?? "").toString();
  if (!offerId) return NextResponse.json({ error: "Missing offerId" }, { status: 400 });

  let thread: InternalThread;
  try {
    thread = decodeToken<InternalThread>(token);
  } catch {
    return NextResponse.json({ error: "Bad token" }, { status: 401 });
  }

  const updated = selectOfferInThread(thread, offerId);
  const nextToken = encodeToken(updated);
  const ui = toUI(updated, new Date());

  return NextResponse.json({ ...ui, token: nextToken }, { status: 200 });
}
