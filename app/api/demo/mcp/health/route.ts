import { NextResponse } from "next/server";
import { loadStoreRegistry } from "../../_lib/storeRegistry";
import { mcpToolsList, mcpSearchProducts } from "../../_lib/mcp";

export async function GET() {
  try {
    const stores = await loadStoreRegistry();
    const enabled = (stores as any[]).filter((s) => s.enabled);

    // Keep this endpoint fast and reliable
    const sample = enabled.slice(0, 3);

    const settled = await Promise.allSettled(
      sample.map(async (s) => {
        const storeBaseUrl = s.domain
          ? `https://${s.domain}`
          : String(s.mcpUrl || "").replace(/\/api\/mcp\/?$/i, "");

        // tools/list quick check
        const tools = await mcpToolsList(s.mcpUrl, 5000);
        const hasSearchShopCatalog = tools.some((t) => t.name === "search_shop_catalog");

        // one lightweight search
        const search = await mcpSearchProducts({
          storeBaseUrl,
          mcpUrl: s.mcpUrl,
          query: "sneakers",
          timeoutMs: 7000
        });

        return {
          id: s.id,
          name: s.name,
          mcpUrl: s.mcpUrl,
          domain: s.domain ?? null,
          toolsListOk: tools.length > 0,
          hasSearchShopCatalog,
          searchOk: search.ok,
          toolUsed: search.toolUsed ?? null,
          productCount: search.products?.length ?? 0,
          firstProduct: search.products?.[0] ?? null,
          error: search.error ?? null
        };
      })
    );

    const results = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        id: sample[i]?.id ?? `store_${i}`,
        name: sample[i]?.name ?? `store_${i}`,
        mcpUrl: sample[i]?.mcpUrl ?? null,
        domain: sample[i]?.domain ?? null,
        toolsListOk: false,
        hasSearchShopCatalog: false,
        searchOk: false,
        toolUsed: null,
        productCount: 0,
        firstProduct: null,
        error: `Health check failed: ${String(r.reason?.message ?? r.reason)}`
      };
    });

    return NextResponse.json(
      { ok: true, checked: results.length, stores: results },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
