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

/* -----------------------------
   Helpers
------------------------------*/

function cleanQuery(raw: string): string {
  return raw
    .replace(/[£$€]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function extractKeyItemWord(text: string): string | null {
  const t = text.toLowerCase();
  const words = [
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
  for (const w of words) if (t.includes(w)) return w;
  return null;
}

function matchesKeyword(title: string, key: string | null): boolean {
  if (!key) return true;
  return title.toLowerCase().includes(key.toLowerCase());
}

function extractBudget(text: string): number | null {
  const m = text.match(/(\d{2,5})/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function parsePrice(priceText: string): { minor: number; currency: string } | null {
  if (!priceText) return null;

  const cleaned = priceText.replace(/[^\d.,]/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return null;

  return {
    minor: Math.round(num * 100),
    currency: "GBP"
  };
}

function buildOffer(args: {
  storeId: string;
  storeName: string;
  product: any;
  parsedPrice: { minor: number; currency: string };
  arrivalDelayMs: number;
}): Offer {
  return {
    id: `o_${args.storeId}_${Math.random().toString(16).slice(2)}`,
    sellerId: args.storeId,
    sellerName: args.storeName,
    headline: args.product.title,
    imageUrl: args.product.imageUrl || "https://placehold.co/600x400/png?text=Product",
    productUrl: args.product.productUrl || "#",
    pricePence: args.parsedPrice.minor,
    currency: args.parsedPrice.currency,
    deliveryDays: 3,
    reliabilityLabel: "Reliable",
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

/* -----------------------------
   Route
------------------------------*/

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const requestText = (body?.requestText ?? "").toString();
  const mode = (body?.mode === "seller" ? "seller" : "buyer") as Mode;
  const debugOn = body?.debug === true;

  if (!requestText.trim()) {
    return NextResponse.json({ error: "Missing requestText" }, { status: 400 });
  }

  const thread = makeInitialThread(requestText, mode);

  const debug: any = debugOn
    ? {
        category: null,
        cleanedQuery: null,
        keyWord: null,
        budget: null,
        storesPicked: [],
        storeResults: []
      }
    : null;

  try {
    const category = classifyIntent(requestText) as StoreCategory;
    const keyWord = extractKeyItemWord(requestText);
    const budget = extractBudget(requestText);
    const query = cleanQuery(requestText);

    if (debug) {
      debug.category = category;
      debug.cleanedQuery = query;
      debug.keyWord = keyWord;
      debug.budget = budget;
    }

    const stores = await loadStoreRegistry();
    const picked = pickStoresForCategory(stores, category, 6); // wider search

    if (debug) {
      debug.storesPicked = picked.map(s => ({
        id: s.id,
        name: s.name,
        mcpUrl: s.mcpUrl
      }));
    }

    const results = await Promise.allSettled(
      picked.map((store, idx) =>
        mcpSearchProducts({
          storeBaseUrl: store.domain
            ? `https://${store.domain}`
            : store.mcpUrl.replace(/\/api\/mcp\/?$/i, ""),
          mcpUrl: store.mcpUrl,
          query,
          timeoutMs: 10000
        }).then(r => ({ store, idx, r }))
      )
    );

    const acceptedOffers: Offer[] = [];

    for (const item of results) {
      if (item.status !== "fulfilled") continue;

      const { store, idx, r } = item.value;

      if (!r.ok || !r.products?.length) {
        if (debug) {
          debug.storeResults.push({
            storeId: store.id,
            ok: false,
            error: r.error || "No products"
          });
        }
        continue;
      }

      const filtered = r.products.filter(p => matchesKeyword(p.title, keyWord));

      for (const product of filtered) {
        const parsed = parsePrice(product.priceText);
        if (!parsed) continue;

        if (budget && parsed.minor > budget * 100) continue;

        acceptedOffers.push(
          buildOffer({
            storeId: store.id,
            storeName: store.name,
            product,
            parsedPrice: parsed,
            arrivalDelayMs: 800 + idx * 900
          })
        );

        if (acceptedOffers.length >= 3) break;
      }

      if (acceptedOffers.length >= 3) break;
    }

    if (acceptedOffers.length) {
      thread.offers = acceptedOffers;
      thread.events.push({
        id: `e_${Math.random().toString(16).slice(2)}`,
        ts: new Date().toISOString(),
        who: "Your assistant",
        text: "Live store responses analysed. Matching offers selected."
      });
    }
  } catch (err: any) {
    if (debug) debug.fatal = String(err?.message ?? err);
  }

  const token = encodeToken(thread);
  const ui = toUI(thread, new Date());

  return NextResponse.json({ ...ui, token, debug }, { status: 200 });
}
