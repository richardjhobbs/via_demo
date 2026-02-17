
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
  const r = await mcpPost(mcpUrl, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, timeoutMs);
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
  try { return JSON.parse(text); } catch { return null; }
}

function extractPayload(resultJson: any): any {
  const content = resultJson?.result?.content;
  if (!Array.isArray(content) || content.length === 0) return resultJson;

  const textParts = content
    .filter((c: any) => c && typeof c.text === "string")
    .map((c: any) => c.text.trim())
    .filter(Boolean);

  if (!textParts.length) return resultJson;

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

function firstNonEmptyScalar(...vals: any[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function getMaybeAmount(x: any): string {
  if (!x) return "";
  if (typeof x === "string" || typeof x === "number") return firstNonEmptyScalar(x);
  if (typeof x === "object") return firstNonEmptyScalar(x.amount, x.value, x.min, x.max);
  return "";
}

function getMaybeCurrency(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "object") return firstNonEmptyString(x.currencyCode, x.currency_code, x.code);
  return "";
}

function currencySymbol(code: string): string {
  const c = (code || "").toUpperCase();
  if (c === "GBP") return "£";
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  if (c === "AUD") return "A$";
  if (c === "CAD") return "C$";
  return c ? `${c} ` : "";
}

function formatMoney(amountRaw: any, currencyRaw: any): string {
  const amountStr = getMaybeAmount(amountRaw);
  if (!amountStr) return "";

  const code = getMaybeCurrency(currencyRaw);
  const sym = currencySymbol(code);

  const n = Number(amountStr);
  const clean =
    Number.isFinite(n)
      ? (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)).replace(/\.00$/, "")
      : amountStr;

  return `${sym}${clean}`.trim();
}

function normaliseProducts(payload: any, storeBaseUrl: string): McpProduct[] {
  const out: McpProduct[] = [];

  const candidates =
    payload?.items ??
    payload?.products ??
    payload?.results ??
    payload?.data?.products ??
    payload?.data?.items ??
    payload?.result?.products ??
    payload?.result?.items ??
    payload?.data?.products?.nodes ??
    payload?.products?.nodes ??
    payload ??
    [];

  const arr = Array.isArray(candidates) ? candidates : [];

  for (const p of arr) {
    const prod = p?.product ?? p;

    const title = firstNonEmptyString(prod?.title, prod?.name);
    if (!title) continue;

    const priceRangeMin = prod?.priceRange?.minVariantPrice ?? prod?.price_range?.min_variant_price;

    const amount =
      prod?.priceText ??
      prod?.price_string ??
      prod?.price ??
      prod?.amount ??
      priceRangeMin?.amount ??
      prod?.priceV2?.amount ??
      prod?.variants?.[0]?.price ??
      prod?.variants?.[0]?.priceV2?.amount;

    const currency =
      priceRangeMin?.currencyCode ??
      prod?.currencyCode ??
      prod?.currency_code ??
      prod?.priceV2?.currencyCode ??
      prod?.variants?.[0]?.priceV2?.currencyCode;

    const priceText =
      (typeof amount === "string" && amount.trim() && amount.trim().match(/[£$€A-Z]/i))
        ? amount.trim()
        : firstNonEmptyString(prod?.priceText, prod?.price_string) || formatMoney(amount, currency);

    const imageUrl = firstNonEmptyString(
      prod?.imageUrl,
      prod?.image,
      prod?.image_url,
      prod?.featuredImage?.url,
      prod?.featured_image?.url,
      prod?.images?.[0]?.url,
      prod?.images?.edges?.[0]?.node?.url,
      prod?.media?.edges?.[0]?.node?.previewImage?.url
    );

    let productUrl = firstNonEmptyString(
      prod?.productUrl,
      prod?.onlineStoreUrl,
      prod?.online_store_url,
      prod?.url,
      prod?.product_url
    );

    const handle = firstNonEmptyString(prod?.handle);

    if (productUrl && productUrl.startsWith("/")) productUrl = storeBaseUrl.replace(/\/$/, "") + productUrl;
    if ((!productUrl || !productUrl.startsWith("http")) && handle) {
      productUrl = storeBaseUrl.replace(/\/$/, "") + "/products/" + handle;
    }
    if (!productUrl || !productUrl.startsWith("http")) productUrl = storeBaseUrl;

    out.push({
      title,
      priceText: priceText || "",
      imageUrl: imageUrl || "",
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
  const timeoutMs = opts.timeoutMs ?? 9000;

  const tools = await mcpToolsList(opts.mcpUrl, timeoutMs);
  if (!tools.length) return { ok: false, products: [], error: "No tools/list response" };

  const toolName = pickSearchTool(tools);
  if (!toolName) return { ok: false, products: [], error: "No search tool found" };

  const callReq: JsonRpcReq = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: {
        query: opts.query,
        context: "Return relevant products with price and image. Prefer in-stock items."
      }
    }
  };

  const r = await mcpPost(opts.mcpUrl, callReq, timeoutMs);
  if (!r.ok || !r.json) return { ok: false, products: [], toolUsed: toolName, error: "Search call failed" };

  const payload = extractPayload(r.json);
  const products = normaliseProducts(payload, opts.storeBaseUrl);

  if (products.length) {
    return { ok: true, products, toolUsed: toolName };
  }

  return { ok: false, products: [], toolUsed: toolName, error: "No usable products returned" };
}
