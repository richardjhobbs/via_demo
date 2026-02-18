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
function isUsableLiveProduct(p: { title: string; imageUrl: string; productUrl: string }) {
  if (!p?.title) return false;
  if (!p?.imageUrl || p.imageUrl.includes("placehold.co")) return false;
  if (!p?.productUrl || p.productUrl === "#") return false;
  return true;
}

type Currency = "USD" | "GBP" | "EUR" | "AUD" | "CAD" | "UNKNOWN";

function currencyFromText(t: string): Currency {
  const s = (t || "").toUpperCase();
  if (s.includes("USD")) return "USD";
  if (s.includes("GBP")) return "GBP";
  if (s.includes("EUR")) return "EUR";
  if (s.includes("AUD")) return "AUD";
  if (s.includes("CAD")) return "CAD";
  if (t.includes("$")) return "USD";
  if (t.includes("£")) return "GBP";
  if (t.includes("€")) return "EUR";
  return "UNKNOWN";
}

// Returns price in "minor units" (cents/pence), plus detected currency.
// If we cannot parse, returns null.
function parsePriceMinor(priceText: string): { minor: number; currency: Currency } | null {
  const raw = (priceText ?? "").toString().trim();
  if (!raw) return null;

  const currency = currencyFromText(raw);

  // Strip everything except digits, dots, commas
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  // Handle "1,299.99" vs "1.299,99" very roughly:
  // If both comma and dot exist, assume comma is thousands separator.
  let normalised = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    normalised = cleaned.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    // likely "199,99" format
    normalised = cleaned.replace(/,/g, ".");
  }

  const val = Number(normalised);
  if (!Number.isFinite(val)) return null;

  return { minor: Math.round(val * 100), currency };
}

type PriceConstraint = {
  minMinor?: number;
  maxMinor?: number;
  currency?: Currency;
};

// Very simple intent parsing: handles "over 200", "under 200", "over USD 200", "$200", "£200", "200+"
function extractPriceConstraint(requestText: string): PriceConstraint {
  const t = (requestText || "").toLowerCase();

  let currency: Currency | undefined;
  if (t.includes("usd")) currency = "USD";
  else if (t.includes("gbp")) currency = "GBP";
  else if (t.includes("eur")) currency = "EUR";
  else if (t.includes("aud")) currency = "AUD";
  else if (t.includes("cad")) currency = "CAD";
  else if (t.includes("$")) currency = "USD";
  else if (t.includes("£")) currency = "GBP";
  else if (t.includes("€")) currency = "EUR";

  // Find a number that looks like a price
  const m = t.match(/(?:usd|gbp|eur|aud|cad)?\s*[$£€]?\s*(\d{2,5})(?:\.(\d{1,2}))?/i);
  const num = m ? Number(m[1] + (m[2] ? "." + m[2] : "")) : null;

  const constraint: PriceConstraint = {};
  if (currency) constraint.currency = currency;

  if (num && Number.isFinite(num)) {
    const minor = Math.round(num * 100);

    // Over / under / below / above heuristics
    if (t.includes("over") || t.includes("above") || t.includes("more than") || t.includes("+")) {
      constraint.minMinor = minor; // treat as >=
    } else if (t.includes("under") || t.includes("below") || t.includes("less than") || t.includes("max")) {
      constraint.maxMinor = minor; // treat as <=
    }
    // If neither over/under, we do not enforce, because user may just be stating a reference.
  }

  return constraint;
}

function withinConstraint(priceMinor: number, c: PriceConstraint): boolean {
  if (typeof c.minMinor === "number" && priceMinor < c.minMinor) return false;
  if (typeof c.maxMinor === "number" && priceMinor > c.maxMinor) return false;
  return true;
}

// Pick a wider pool, then take the first 3 that actually return usable products that satisfy constraints.
function pickCandidateStores(stores: StoreEntry[], category: StoreCategory, max = 9): StoreEntry[] {
  const filtered = stores.filter(s => s.enabled && s.category === category);

  // Shuffle for variety
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);

  // Bias by weight
  shuffled.sort((a, b) => (b.weight ?? 100) - (a.weight ?? 100));

  return shuffled.slice(0, max);
}

function offerFromMcpProduct(args: {
  storeId: string;
  storeName: string;
  title: string;
  priceText: string;
  priceMinor: number;
  currency: Currency;
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
    // NOTE: field name is legacy; we store minor units (cents/pence) regardless of currency
    pricePence: args.priceMinor,
    priceTextOverride: args.priceText || "",
    currency: (args.currency === "UNKNOWN" ? "USD" : args.currency) as any,
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

  const debugOn = body?.debug === true;
  const debug: any = debugOn
    ? {
        category: null as any,
        cleanedQuery: null as any,
        keyWord: null as any,
        priceConstraint: null as any,
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
    const priceConstraint = extractPriceConstraint(requestText);

    if (debug) {
      debug.category = category;
      debug.cleanedQuery = q;
      debug.keyWord = keyWord;
      debug.priceConstraint = priceConstraint;
    }

    const stores = await loadStoreRegistry();
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

      // Intentionally slower pacing
      const baseDelay = 1600;
      const stepDelay = 1900;

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

        if (!r.ok || !r.products.length) {
          if (debug) {
            debug.storeResults.push({
              storeId: store.id,
              storeName: store.name,
              ok: r.ok,
              toolUsed: r.toolUsed,
              error: r.error,
              productCount: r.products?.length ?? 0,
              accepted: false,
              reason: "No products"
            });
          }
          continue;
        }

        // Filter to usable live products with parsable price that meets constraint (if any)
        const candidatesProducts = r.products
          .filter(p => isUsableLiveProduct(p))
          .map(p => {
            const parsed = parsePriceMinor(p.priceText || "");
            return { p, parsed };
          })
          .filter(x => x.parsed !== null)
          .filter(x => withinConstraint((x.parsed as any).minor, priceConstraint));

        // Prefer keyword match within the filtered set
        let chosen: any = null;
        if (candidatesProducts.length) {
          chosen =
            candidatesProducts.find(x => matchesKeyWord(x.p.title, keyWord)) ||
            candidatesProducts[0];
        }

        if (!chosen) {
          if (debug) {
            debug.storeResults.push({
              storeId: store.id,
              storeName: store.name,
              ok: r.ok,
              toolUsed: r.toolUsed,
              error: r.error,
              productCount: r.products?.length ?? 0,
              accepted: false,
              reason: "No usable products meeting price constraint"
            });
          }
          continue;
        }

        const parsed = chosen.parsed as { minor: number; currency: Currency };
        const delay = baseDelay + liveOffers.length * stepDelay;

        // Decide currency: prefer constraint currency if present, else parsed currency
        const cur: Currency = priceConstraint.currency && priceConstraint.currency !== "UNKNOWN"
          ? priceConstraint.currency
          : parsed.currency;

        const trust: "Verified" | "Reliable" | "New" =
          (store.weight ?? 100) >= 120 ? "Verified" : "Reliable";

        liveOffers.push(
          offerFromMcpProduct({
            storeId: store.id,
            storeName: store.name,
            title: chosen.p.title,
            priceText: chosen.p.priceText,
            priceMinor: parsed.minor,
            currency: cur,
            imageUrl: chosen.p.imageUrl,
            productUrl: chosen.p.productUrl,
            arrivalDelayMs: delay,
            reliabilityLabel: trust
          })
        );

        if (debug) {
          debug.storeResults.push({
            storeId: store.id,
            storeName: store.name,
            ok: r.ok,
            toolUsed: r.toolUsed,
            error: r.error,
            productCount: r.products?.length ?? 0,
            accepted:
