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
  type StoreCategory,
  type StoreEntry
} from "../_lib/storeRegistry";
import { mcpSearchProducts } from "../_lib/mcp";

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

// Prefer offers that look "real" to humans.
// Price can be blank for some stores, but image + productUrl are essential for credibility.
function isUsableLiveProduct(p: { title: string; imageUrl: string; productUrl: string; priceText: string }) {
  if (!p?.title) return false;
  if (!p?.imageUrl || p.imageUrl.includes("placehold.co")) return false;
  if (!p?.productUrl || p.productUrl === "#") return false;
  return true;
}

// Pick more stores than we need, then take the first 3 that actually return usable products.
// This is how you avoid being dependent on specific merchants.
function pickCandidateStores(stores: StoreEntry[], category: StoreCategory, max = 9): StoreEntry[] {
  const filtered = stores.filter(s => s.enabled && s.category === category);

  // Shuffle to avoid the same 3 every time.
  // Not cryptographically secure, just enough for variety.
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);

  // Weight can still bias selection: push higher weight earlier.
  shuffled.sort((a, b) => (b.weight ?? 100) - (a.weight ?? 100));

  return shuffled.slice(0, max);
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

  // Optional debug: send { debug:true } in the POST body if you ever wire it in the UI.
  const debugOn = body?.debug === true;
  const debug: any = debugOn
    ? {
        category: null as any,
        cleanedQuery: null as any,
        keyWord: null as any,
        candidateStores: [] as any[],
        contacted: 0,
        collectedOffers: 0,
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

    // IMPORTANT CHANGE:
    // We do NOT pick only 3. We pick a wider pool, then we take the first 3 that actually respond with usable products.
    const candidates = pickCandidateStores(stores, category, 9);

    if (debug) {
      debug.candidateStores = candidates.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        mcpUrl: s.mcpUrl,
        category: s.category,
        weight: s.weight ?? 100
      }));
    }

    if (candidates.length) {
      const liveOffers: Offer[] = [];

      // Slower pacing looks more “considered”.
      // This is intentionally not “fastest possible”.
      const baseDelay = 1400;
      const stepDelay = 1700;

      // Contact stores sequentially until we have 3 usable offers or we run out.
      // Sequential also makes the demo more reliable under rate limits and intermittent failures.
      for (const store of candidates) {
        if (liveOffers.length >= 3) break;

        const storeBaseUrl = store.domain
          ? `https://${store.domain}`
          : store.mcpUrl.replace(/\/api\/mcp\/?$/i, "");

        const r = await mcpSearchProducts({
          storeBaseUrl,
          mcpUrl: store.mcpUrl,
          query: q,
          timeoutMs: 12000
        });

        if (debug) debug.contacted += 1;

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

        // Skip products that do not look live/credible (missing image/url).
        if (!isUsableLiveProduct(matched)) continue;

        // Reliability: keep simple and not merchant-specific.
        // If a store is higher weight, label Verified. Otherwise Reliable.
        const trust: "Verified" | "Reliable" | "New" =
          (store.weight ?? 100) >= 120 ? "Verified" : "Reliable";

        const delay = baseDelay + liveOffers.length * stepDelay;

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

        if (debug) debug.collectedOffers = liveOffers.length;
      }

      // Replace mocks only if we have at least 1 live offer.
      if (liveOffers.length >= 1) {
        thread.offers = liveOffers;

        const nowIso = new Date().toISOString();
        thread.events.push({
          id: `e_${Math.random().toString(16).slice(2)}`,
          ts: nowIso,
          who: "Your assistant",
          text: `I contacted ${Math.min(candidates.length, 9)} participating sellers. Live responses are coming in now.`
        });
      }
    }
  } catch (e: any) {
    if (debug) debug.fatal = String(e?.message ?? e);
    // keep mock offers if anything fails
  }

  const token = encodeToken(thread);
  const ui = toUI(thread, new Date());

  return NextResponse.json({ ...ui, token, debug }, { status: 200 });
}
