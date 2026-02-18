
import { NextResponse } from "next/server";
import {
  encodeToken,
  makeInitialThread,
  toUI,
  type Mode,
  type Offer,
  classifyIntent
} from "../_lib/demo";
import {
  loadStoreRegistry,
  pickStoresForCategory,
  type StoreCategory
} from "../_lib/storeRegistry";
import { mcpSearchProducts } from "../_lib/mcp";

function cleanQuery(raw: string): string {
  // We do NOT try to filter by price. We just remove currency symbols that confuse search.
  return (raw || "")
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

function guessCurrency(priceText: string): string {
  const t = (priceText || "").toUpperCase();

  if (t.includes("USD") || t.includes("$")) return "USD";
  if (t.includes("EUR") || t.includes("€")) return "EUR";
  if (t.includes("GBP") || t.includes("£")) return "GBP";
  if (t.includes("AUD")) return "AUD";
  if (t.includes("CAD")) return "CAD";
  if (t.includes("SGD")) return "SGD";
  if (t.includes("HKD")) return "HKD";
  if (t.includes("JPY") || t.includes("¥")) return "JPY";

  return "UNKNOWN";
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

    // For demo: we show merchant's own price string, and do not rely on numeric conversion.
    pricePence: 0,
    currency: guessCurrency(args.priceText),
    priceTextOverride: args.priceText || "",

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

  // Optional debug: { debug: true }
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
    const picked = pickStoresForCategory(stores, category, 6); // broaden to find 3 that respond

    if (debug) {
      debug.storesPicked = picked.map((s: any) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        mcpUrl: s.mcpUrl,
        category: s.category
      }));
    }

    const results = await Promise.allSettled(
      picked.map((s: any, idx: number) => {
        const storeBaseUrl = s.domain
          ? `https://${s.domain}`
          : s.mcpUrl.replace(/\/api\/mcp\/?$/i, "");

        return mcpSearchProducts({
          storeBaseUrl,
          mcpUrl: s.mcpUrl,
          query: q,
          timeoutMs: 12000
        }).then((r) => ({ store: s, idx, r }));
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

      // Prefer keyword match, else first product
      const matched =
        r.products.find((p) => matchesKeyWord(p.title, keyWord)) || r.products[0];

      // Slower staggering reads as “real process”
      const delay = 1200 + idx * 1400;

      const trust: "Verified" | "Reliable" | "New" =
        store.id.toLowerCase().includes("allbirds") ? "Verified" : "Reliable";

      liveOffers.push(
        offerFromMcpProduct({
          storeId: store.id,
          storeName: store.name,
          title: matched.title,
          priceText: matched.priceText || "",
          imageUrl: matched.imageUrl,
          productUrl: matched.productUrl,
          arrivalDelayMs: delay,
          reliabilityLabel: trust
        })
      );

      if (liveOffers.length >= 3) break;
    }

    if (liveOffers.length >= 1) {
      thread.offers = liveOffers;

      const nowIso = new Date().toISOString();
      thread.events.push({
        id: `e_${Math.random().toString(16).slice(2)}`,
        ts: nowIso,
        who: "Your assistant",
        text:
          "Tip: for the demo, avoid adding price limits in the request. We show each seller’s normal price and options as quoted, without filtering or conversion."
      });
    }
  } catch (e: any) {
    if (debug) debug.fatal = String(e?.message ?? e);
  }

  const token = encodeToken(thread);
  const ui = toUI(thread, new Date());

  return NextResponse.json({ ...ui, token, debug }, { status: 200 });
}
