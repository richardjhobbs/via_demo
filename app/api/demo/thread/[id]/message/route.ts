import { NextResponse } from "next/server";
import { loadStoreRegistry } from "../../_lib/storeRegistry";
import { mcpToolsList, mcpSearchProducts } from "../../_lib/mcp";

export async function GET() {
  try {
    const stores = await loadStoreRegistry();
    const enabled = (stores as any[]).filter(s => s.enabled);

    const results = await Promise.all(
      enabled.map(async (s) => {
        const storeBaseUrl = s.domain
          ? `https://${s.domain}`
          : s.mcpUrl.replace(/\/api\/mcp\/?$/i, "");

        const tools = await mcpToolsList(s.mcpUrl, 7000);
        const hasSearch = tools.some(t => t.name === "search_shop_catalog");

        const search = await mcpSearchProducts({
          storeBaseUrl,
          mcpUrl: s.mcpUrl,
          query: "sneakers",
          timeoutMs: 9000
        });

        return {
          id: s.id,
          name: s.name,
          mcpUrl: s.mcpUrl,
          domain: s.domain ?? null,
          toolsListOk: tools.length > 0,
          hasSearchShopCatalog: hasSearch,
          searchOk: search.ok,
          toolUsed: search.toolUsed ?? null,
          productCount: search.products?.length ?? 0,
          firstProduct: search.products?.[0] ?? null,
          error: search.error ?? null
        };
      })
    );

    return NextResponse.json({ ok: true, stores: results }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
