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
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
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
  } catch (e: any) {
    return { ok: false, status: 0, json: null, text: String(e?.message ?? e) };
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
  const names = tools.map((t) => t.name);

  if (names.includes("search_shop_catalog")) return "search_shop_catalog";

  const strong = names.find((n) => /search/i.test(n) && /(catalog|product|products|shop)/i.test(n));
  if (strong) return strong;

  const anySearch = names.find((n) => /search/i.test(n));
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

function extractPayload(resultJson: any): any {
  // If server returns direct object in result, accept it
  const direct = resultJson?.result;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    // Sometimes result is { products: [...] } already
    if (direct.products || direct.items || direct.results) return direct;
  }

  // Typical MCP tools/call format:
  // { result: { content: [{ type:"text", text:"..." }, {type:"json", data:{...}}] } }
  const content = resultJson?.result?.content;
  if (!Array.isArray(content) || content.length === 0) return resultJson;

  // Prefer json blocks
  for (const c of content) {
    if (!c) continue;
    if (c.type === "json" && c.data) return c.data;
    if (c.type === "application/json" && c.data) return c.data;
  }

  // Fallback to text blocks
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

function normaliseShopifyEdges(payload: any, storeBaseUrl: string): McpProduct[] {
  // Handle Storefront-style shapes:
  // { products: { edges: [ { node: { title, handle, images:{edges:[{node:{url}}]}, priceRange:{minVariantPrice:{amount,currencyCode}} } } ] } }
  const edges =
    payload?.products?.edges ??
    payload?.data?.products?.edges ??
    payload?.catalog?.products?.edges ??
    null;

  if (!Array.isArray(edges)) return [];

  const out: McpProduct[] = [];
  for (const e of edges) {
    const node = e?.node;
    if (!node) continue;

    const title = firstNonEmptyString(node?.title);
    if (!title) continue;

    const amount = firstNonEmptyString(node?.priceRange?.minVariantPrice?.amount);
    const currency = firstNonEmptyString(node?.priceRange?.minVariantPrice?.currencyCode);
    const priceText = amount ? (currency ? `${currency} ${amount}` : amount) : "";

    const img =
      firstNonEmptyString(node?.featuredImage?.url) ||
      firstNonEmptyString(node?.images?.edges?.[0]?.node?.url);

    const handle = firstNonEmptyString(node?.handle);
    let productUrl = firstNonEmptyString(node?.onlineStoreUrl);
    if (!productUrl && handle) productUrl = storeBaseUrl.replace(/\/$/, "") + "/products/" + handle;
    if (!productUrl) productUrl = storeBaseUrl;

    out.push({
      title,
      priceText,
      imageUrl: img || "",
      productUrl
    });
  }

  return out;
}

function normaliseProducts(payload: any, storeBaseUrl: string): McpProduct[] {
  // First try storefront edge form
  const edgeOut = normaliseShopifyEdges(payload, storeBaseUrl);
  if (edgeOut.length) return edgeOut;

  const out: McpProduct[] = [];

  const candidates =
    payload?.items ??
    payload?.products ??
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

    const priceText = firstNonEmptyString(
      prod?.priceText,
      prod?.price,
      prod?.price_string,
      prod?.amount,
      prod?.priceRange?.minVariantPrice?.amount
    );

    const imageUrl = firstNonEmptyString(
      prod?.imageUrl,
      prod?.image_url,
      prod?.featuredImage?.url,
      prod?.featured_image?.url,
      prod?.images?.[0]?.url,
      prod?.images?.edges?.[0]?.node?.url
    );

    let productUrl = firstNonEmptyString(prod?.productUrl, prod?.url, prod?.product_url, prod?.onlineStoreUrl);
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

  const attempts = [
    { query: opts.query, limit: 6 },
    { query: opts.query, first: 6 },
    { query: opts.query, count: 6 },
    { q: opts.query, limit: 6 }
  ];

  let lastErr = "";

  for (const args of attempts) {
    const callReq: JsonRpcReq = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    };

    const r = await mcpPost(opts.mcpUrl, callReq, timeoutMs);
    if (!r.ok || !r.json) {
      lastErr = `HTTP ${r.status} ${r.text?.slice(0, 160) ?? ""}`.trim();
      continue;
    }

    // MCP errors are often { error: { message } }
    const rpcErr = r.json?.error?.message || r.json?.error;
    if (rpcErr) {
      lastErr = String(rpcErr).slice(0, 200);
      continue;
    }

    const payload = extractPayload(r.json);
    const products = normaliseProducts(payload, opts.storeBaseUrl);

    if (products.length) {
      return { ok: true, products, toolUsed: toolName };
    } else {
      lastErr = "Search returned 0 usable products (parse mismatch or irrelevant results)";
    }
  }

  return { ok: false, products: [], toolUsed: toolName, error: lastErr || "Search returned no products" };
}
