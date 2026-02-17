// app/api/demo/_lib/mcp.ts

type JsonRpcReq = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
};

async function mcpPost(mcpUrl: string, req: JsonRpcReq, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: ctrl.signal
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

export async function mcpToolsList(mcpUrl: string, timeoutMs = 6000) {
  const r = await mcpPost(
    mcpUrl,
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    timeoutMs
  );
  if (!r.ok || !r.json?.result?.tools) return [];
  return r.json.result.tools as Array<{ name: string; description?: string; inputSchema?: any }>;
}

function pickSearchTool(tools: Array<{ name: string }>) {
  const names = tools.map(t => t.name);
  if (names.includes("search_shop_catalog")) return "search_shop_catalog";

  const strong = names.find(n => /search/i.test(n) && /(catalog|product|products|shop)/i.test(n));
  if (strong) return strong;

  const anySearch = names.find(n => /search/i.test(n));
  if (anySearch) return anySearch;

  return null;
}

export type McpProduct = {
  title: string;
  priceText: string;
  imageUrl: string;
  productUrl: string;
};

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Shopify Storefront MCP tools/call responses are JSON-RPC like:
 * { jsonrpc:"2.0", id:1, result: { content:[{type:"text", text:"{...json...}"}], isError?:boolean } }
 *
 * Some servers (or wrappers) may return:
 * { content:[...], isError:true }
 */
function extractPayload(anyJson: any): any {
  const container = anyJson?.result ?? anyJson; // tolerate both shapes
  const content = container?.content;

  if (!Array.isArray(content) || content.length === 0) return container;

  // Prefer explicit JSON blocks if present
  const jsonBlocks = content.filter((c: any) => c && (c.type === "json" || c.type === "application/json"));
  if (jsonBlocks.length && jsonBlocks[0]?.json) return jsonBlocks[0].json;

  // Shopify MCP usually returns JSON encoded inside a text block
  const textParts = content
    .filter((c: any) => c && typeof c.text === "string")
    .map((c: any) => c.text.trim())
    .filter(Boolean);

  if (!textParts.length) return container;

  const maybe = safeJsonParse(textParts[0]);
  if (maybe) return maybe;

  return { text: textParts.join("\n") };
}

function firstNonEmptyString(...vals: any[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function toCurrencySymbol(code: string): string {
  const c = (code || "").toUpperCase();
  if (c === "GBP") return "£";
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  return ""; // fallback to "CODE " prefix
}

function formatPrice(amountRaw: any, currencyRaw: any): string {
  const currency = String(currencyRaw || "").toUpperCase().trim();

  const num =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw)
        : NaN;

  if (!Number.isFinite(num)) return "";

  // Shopify often returns "28.0" etc. Keep 2dp only if needed.
  const isInt = Math.abs(num - Math.round(num)) < 1e-9;
  const amountStr = isInt ? String(Math.round(num)) : num.toFixed(2);

  const sym = toCurrencySymbol(currency);
  if (sym) return `${sym}${amountStr}`;
  if (currency) return `${currency} ${amountStr}`;
  return amountStr;
}

function normaliseProducts(payload: any, storeBaseUrl: string): McpProduct[] {
  const out: McpProduct[] = [];

  // Shopify MCP shape: { products:[...] }
  // Keep a few alternates for other MCPs.
  const candidates =
    payload?.products ??
    payload?.items ??
    payload?.results ??
    payload?.data?.products ??
    payload?.data ??
    payload ??
    [];

  const arr = Array.isArray(candidates) ? candidates : [];

  for (const p of arr) {
    const prod = p?.product ?? p;

    const title = firstNonEmptyString(prod?.title, prod?.name);
    if (!title) continue;

    // --- PRICE (Shopify MCP) ---
    // Primary: price_range.min + price_range.currency
    const prMin = prod?.price_range?.min;
    const prCur = prod?.price_range?.currency;

    // Secondary: first variant price/currency
    const v0 = Array.isArray(prod?.variants) ? prod.variants[0] : null;
    const vPrice = v0?.price;
    const vCur = v0?.currency;

    // Tertiary: any other known shapes (keep what you already attempted)
    const gqlAmount = prod?.priceRange?.minVariantPrice?.amount;
    const gqlCur = prod?.priceRange?.minVariantPrice?.currencyCode;

    const priceText =
      formatPrice(prMin, prCur) ||
      formatPrice(vPrice, vCur) ||
      formatPrice(gqlAmount, gqlCur) ||
      firstNonEmptyString(prod?.priceText, prod?.price, prod?.price_string, prod?.amount);

    // --- IMAGE (Shopify MCP uses image_url) ---
    const imageUrl =
      firstNonEmptyString(
        prod?.image_url,
        prod?.imageUrl,
        prod?.image,
        prod?.image_url,
        prod?.featuredImage?.url,
        prod?.featured_image?.url,
        prod?.images?.[0]?.url,
        v0?.image_url
      ) || "";

    // --- URL (Shopify MCP uses url) ---
    let productUrl = firstNonEmptyString(prod?.url, prod?.productUrl, prod?.product_url);
    const handle = firstNonEmptyString(prod?.handle);

    if (productUrl && productUrl.startsWith("/")) productUrl = storeBaseUrl.replace(/\/$/, "") + productUrl;
    if ((!productUrl || !productUrl.startsWith("http")) && handle) {
      productUrl = storeBaseUrl.replace(/\/$/, "") + "/products/" + handle;
    }
    if (!productUrl || !productUrl.startsWith("http")) productUrl = storeBaseUrl;

    out.push({
      title,
      priceText: priceText || "",
      imageUrl,
      productUrl
    });
  }

  return out;
}

export async function mcpSearchProducts(opts: {
  storeBaseUrl: string;
  mcpUrl: string;
  query: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; products: McpProduct[]; toolUsed?: string; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 12000;

  const tools = await mcpToolsList(opts.mcpUrl, timeoutMs);
  if (!tools.length) return { ok: false, products: [], error: "No tools/list response" };

  const toolName = pickSearchTool(tools);
  if (!toolName) return { ok: false, products: [], error: "No search tool found" };

  // Shopify docs: both query + context are required for search_shop_catalog. :contentReference[oaicite:1]{index=1}
  const context = "Customer is shopping and wants relevant in-stock options with clear pricing.";

  // Keep multiple argument shapes, but ALWAYS include context for Shopify MCP.
  const attempts = [
    { query: opts.query, context, limit: 10 },
    { query: opts.query, context, first: 10 },
    { query: opts.query, context, count: 10 },
    { q: opts.query, context, limit: 10 }
  ];

  for (const args of attempts) {
    const callReq: JsonRpcReq = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    };

    const r = await mcpPost(opts.mcpUrl, callReq, timeoutMs);
    if (!r.ok || !r.json) continue;

    const payload = extractPayload(r.json);

    // If MCP marks error, don’t treat as success.
    const container = r.json?.result ?? r.json;
    if (container?.isError) continue;

    const products = normaliseProducts(payload, opts.storeBaseUrl);
    if (products.length) return { ok: true, products, toolUsed: toolName };
  }

  return { ok: false, products: [], toolUsed: toolName, error: "Search returned no products" };
}
