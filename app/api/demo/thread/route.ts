import { NextResponse } from "next/server";
import {
  encodeToken,
  makeInitialThread,
  toUI,
  type Mode,
  type Offer,
  classifyIntent
} from "./_lib/demo";
import {
  loadStoreRegistry,
  pickStoresForCategory,
  type StoreCategory
} from "./_lib/storeRegistry";
import { mcpSearchProducts } from "./_lib/mcp";

function cleanQuery(raw: string): string {
  return raw
    .replace(/[£$€]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function extractKeyItemWord(requestText: string): string | null {
  const t = requestText.toLowerCase();
  const keywords = [
    "helmet",
    "sneakers",
    "trainer",
    "shoe",
    "jacket",
    "boots",
    "leash",
    "collar",
    "treats",
    "kibble",
    "litter",
    "toy"
  ];
  for (const k of keywords) if (t.includes(k)) return k;
  return null;
}

function matchesKeyWord(title: string, key: string | null): boolean {
  if (!key) return true;
  return title.toLowerCase().includes(key.toLowerCase());
}

function offerFromMcpProduct(args: {
  storeId: string;
  storeName: string;
  title: string;
  priceText: string;
  imageUrl: string;
  productUrl: string;
  arrivalDelayMs: number;
  reliabilityLabel: "Verified" | "Reliable" | "New";
}): Offer {
  return {
    id: `o_${args.storeId}_${Math.random().toString(16).slice(2)}`,
    sellerId: args.storeId,
    sellerName: args.storeName,
    headline: args.title,
    imageUrl: args.imageUrl || "https://placehold.co/600x400/png?text=Product",
    productUrl: args.productUrl || "#",
    pricePence: 0,
    priceTextOverride: args.priceText || "",
    currency: "GBP",
    deliveryDays: 3,
    reliabilityLabel: args.reliabilityLabel,
    replyClass: "normal",
    arrivalDelayMs: args.arrivalDelayMs,
    sourceLabel: "Live store response",
    policy: {
      minPricePence: 0,
      canUpgradeDelivery: true,
      upgradeFeePence: 500,
      maxDiscountPence: 700
    }
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const requestText = (body?.requestText ?? "").toString();
  const mode = (body?.mode === "seller" ? "seller" : "buyer") as Mode;

  if (!requestText.trim()) {
    return NextResponse.json({ error: "Missing requestText" }, { status: 400 });
  }

  const thread = makeInitialThread(requestText, mode);

  // Debug mode: you can pass { debug: true } in the POST body from the UI.
  // If you do not have that wired, we still include debug safely when body.debug === true.
  const debugOn = body?.debug === true;

  const debug: any = debugOn
    ? {
        category: null as any,
        cleanedQuery: null as any,
        keyWord: null as any,
        storesPicked: [] as any[],
        storeResults: [] as any[]
      }
    : null;

  try {
    const category = classifyIntent(requestText) as StoreCategory;
    const keyWord = extractKeyItemWord(requestText);
    const q = cleanQuery(requestText);

    if (debug) {
      debug.category = category;
      debug.cleanedQuery = q;
      debug.keyWord = keyWord;
    }

    const stores = await loadStoreRegistry();
    const picked = pickStoresForCategory(stores, category, 3);

    if (debug) {
      debug.storesPicked = picked.map((s: any) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        mcpUrl: s.mcpUrl,
        category: s.category
      }));
    }

    if (picked.length) {
      const results = await Promise.allSettled(
        picked.map((s: any, idx: number) => {
          const storeBaseUrl = s.domain
            ? `https://${s.domain}`
            : s.mcpUrl.replace(/\/api\/mcp\/?$/i, "");

          return mcpSearchProducts({
            storeBaseUrl,
            mcpUrl: s.mcpUrl,
            query: q,
            timeoutMs: 9000
          }).then((r) => ({ store: s, idx, r, storeBaseUrl }));
        })
      );

      const liveOffers: Offer[] = [];

      for (const item of results) {
        if (item.status !== "fulfilled") {
          if (debug) debug.storeResults.push({ ok: false, error: "Promise rejected" });
          continue;
        }

        const { store, idx, r } = item.value;

        if (debug) {
          debug.storeResults.push({
            storeId: store.id,
            storeName: store.name,
            ok: r.ok,
            toolUsed: r.toolUsed,
            error: r.error,
            productCount: r.products?.length ?? 0,
            firstProduct: r.products?.[0] ?? null
          });
        }

        if (!r.ok || !r.products.length) continue;

        const matched =
          r.products.find((p) => matchesKeyWord(p.title, keyWord)) || r.products[0];

        const delay = 700 + idx * 900;
        const trust: "Verified" | "Reliable" | "New" =
          store.id.toLowerCase().includes("allbirds") ? "Verified" : "Reliable";

        liveOffers.push(
          offerFromMcpProduct({
            storeId: store.id,
            storeName: store.name,
            title: matched.title,
            priceText: matched.priceText,
            imageUrl: matched.imageUrl,
            productUrl: matched.productUrl,
            arrivalDelayMs: delay,
            reliabilityLabel: trust
          })
        );
      }

      // Replace mocks if we have at least 1 live offer
      if (liveOffers.length >= 1) {
        thread.offers = liveOffers;

        const nowIso = new Date().toISOString();
        thread.events.push({
          id: `e_${Math.random().toString(16).slice(2)}`,
          ts: nowIso,
          who: "Your assistant",
          text: "Live store responses are coming in now."
        });
      }
    }
  } catch (e: any) {
    if (debug) debug.fatal = String(e?.message ?? e);
    // keep mock offers if MCP fails
  }

  const token = encodeToken(thread);
  const ui = toUI(thread, new Date());

  // Debug is included only when you send debug:true in the POST body.
  return NextResponse.json({ ...ui, token, debug }, { status: 200 });
}
