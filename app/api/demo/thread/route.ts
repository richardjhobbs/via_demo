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

type IntentPlan = {
  category?: "SNEAKERS" | "OUTDOORS" | "CYCLING" | "PET_SUPPLIES" | "NOT_SPECIFIED";
  core_item?: string;
  required_terms?: string[];
  preferred_terms?: string[];
  excluded_terms?: string[];
  search_query?: string;
  broadcast_intent?: string;
};

function cleanQuery(raw: string): string {
  return (raw || "")
    .replace(/[£$€]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normaliseStoreCategory(planCat: IntentPlan["category"], fallbackText: string): StoreCategory {
  const c = String(planCat ?? "").toUpperCase().trim();
  if (c === "SNEAKERS") return "sneakers";
  if (c === "OUTDOORS") return "outdoor";
  if (c === "CYCLING") return "cycling";
  if (c === "PET_SUPPLIES") return "pet";

  // fallback to local classifier
  const k = classifyIntent(fallbackText);
  if (k === "sneakers") return "sneakers";
  if (k === "outdoor") return "outdoor";
  if (k === "cycling") return "cycling";
  return "pet";
}

function toTerms(arr: any, max = 12): string[] {
  const items = Array.isArray(arr) ? arr : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const t = String(raw ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 32);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function scoreTitle(title: string, plan: IntentPlan, strictRequired: boolean): { score: number; rejected: boolean } {
  const t = (title || "").toLowerCase();
  if (!t) return { score: -999, rejected: true };

  const required = toTerms(plan.required_terms, 8);
  const preferred = toTerms(plan.preferred_terms, 10);
  const excluded = toTerms(plan.excluded_terms, 12);

  // If strict pass and any required term missing, reject.
  if (strictRequired && required.length > 0) {
    for (const r of required) {
      if (!t.includes(r)) return { score: -999, rejected: true };
    }
  }

  // Reject if excluded terms appear AND none of the required terms appear.
  // This stops hats showing for helmet intent, but only because the LLM told us to exclude hats.
  const hasAnyRequired = required.length === 0 ? false : required.some((r) => t.includes(r));
  const hasExcluded = excluded.some((x) => t.includes(x));
  if (hasExcluded && !hasAnyRequired) return { score: -999, rejected: true };

  let score = 0;

  for (const r of required) {
    if (t.includes(r)) score += 6;
  }
  for (const p of preferred) {
    if (t.includes(p)) score += 2;
  }
  for (const x of excluded) {
    if (t.includes(x)) score -= 7;
  }

  return { score, rejected: false };
}

function pickBestProduct(products: any[], plan: IntentPlan, strictRequired: boolean) {
  if (!products?.length) return null;

  let best: any = null;
  let bestScore = -999;

  for (const p of products) {
    const title = String(p?.title ?? "");
    const s = scoreTitle(title, plan, strictRequired);
    if (s.rejected) continue;

    if (s.score > bestScore) {
      bestScore = s.score;
      best = p;
    }
  }

  return best;
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

  const mode = (body?.mode === "seller" ? "seller" : "buyer") as Mode;

  const rawRequestText = (body?.requestText ?? "").toString().trim();
  const intentPlan = (body?.intent_plan ?? null) as IntentPlan | null;

  // What we display in the thread as the request
  const requestText = (intentPlan?.broadcast_intent || rawRequestText).trim();

  if (!requestText) {
    return NextResponse.json({ error: "Missing requestText" }, { status: 400 });
  }

  const thread = makeInitialThread(requestText, mode);

  const debugOn = body?.debug === true;
  const debug: any = debugOn
    ? {
        used_intent_plan: Boolean(intentPlan),
        intent_plan: intentPlan,
        category: null as any,
        mcp_query: null as any,
        storesPicked: [] as any[],
        storeResults: [] as any[],
        passUsed: null as any
      }
    : null;

  try {
    const storeCategory = normaliseStoreCategory(intentPlan?.category, requestText);

    const q = cleanQuery(intentPlan?.search_query || requestText);

    if (debug) {
      debug.category = storeCategory;
      debug.mcp_query = q;
    }

    const stores = await loadStoreRegistry();
    const picked = pickStoresForCategory(stores, storeCategory, 6);

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
        const storeBaseUrl = s.domain ? `https://${s.domain}` : s.mcpUrl.replace(/\/api\/mcp\/?$/i, "");
        return mcpSearchProducts({
          storeBaseUrl,
          mcpUrl: s.mcpUrl,
          query: q,
          timeoutMs: 12000
        }).then((r) => ({ store: s, idx, r }));
      })
    );

    const liveOffers: Offer[] = [];

    // Pass 1: strict required_terms if present.
    // Pass 2: relax (still uses excluded penalties).
    for (const pass of [1, 2]) {
      const strict = pass === 1;

      for (const item of results) {
        if (liveOffers.length >= 3) break;
        if (item.status !== "fulfilled") {
          if (debug) debug.storeResults.push({ ok: false, error: "Promise rejected", pass });
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
            firstProduct: r.products?.[0] ?? null,
            pass,
            strict
          });
        }

        if (!r.ok || !r.products.length) continue;

        const planForScoring: IntentPlan = intentPlan || {
          required_terms: [],
          preferred_terms: [],
          excluded_terms: []
        };

        const best = pickBestProduct(r.products, planForScoring, strict) || r.products[0];

        const delay = 1200 + idx * 1400;

        const trust: "Verified" | "Reliable" | "New" =
          store.id.toLowerCase().includes("allbirds") ? "Verified" : "Reliable";

        liveOffers.push(
          offerFromMcpProduct({
            storeId: store.id,
            storeName: store.name,
            title: best.title,
            priceText: best.priceText || "",
            imageUrl: best.imageUrl,
            productUrl: best.productUrl,
            arrivalDelayMs: delay,
            reliabilityLabel: trust
          })
        );
      }

      if (liveOffers.length >= 3) {
        if (debug) debug.passUsed = pass;
        break;
      }
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