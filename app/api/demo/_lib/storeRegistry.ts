import { promises as fs } from "fs";
import path from "path";

export type StoreCategory = "sneakers" | "outdoor" | "cycling" | "pet";

export type StoreEntry = {
  id: string;
  name: string;
  category: StoreCategory;
  domain?: string;
  mcpUrl: string;
  enabled: boolean;
  weight?: number;
  tags?: string[];
};

function normaliseCategory(raw: string): StoreCategory | null {
  const c = (raw || "").toLowerCase().trim();

  if (c === "sneakers" || c === "sneaker") return "sneakers";
  if (c === "outdoor" || c === "outdoors") return "outdoor";
  if (c === "cycling" || c === "cycle" || c === "bike") return "cycling";
  if (c === "pet" || c === "pets" || c === "pet supplies") return "pet";

  // common capitalised inputs like "Sneakers"
  if (c.includes("sneak")) return "sneakers";
  if (c.includes("outdoor")) return "outdoor";
  if (c.includes("cycl")) return "cycling";
  if (c.includes("pet")) return "pet";

  return null;
}

export async function loadStoreRegistry(): Promise<StoreEntry[]> {
  const file = path.join(process.cwd(), "data", "mcp_stores.json");
  const txt = await fs.readFile(file, "utf-8");
  const json = JSON.parse(txt);

  const storesRaw = Array.isArray(json?.stores) ? json.stores : [];
  const out: StoreEntry[] = [];

  for (const s of storesRaw) {
    const id = (s?.id ?? "").toString().trim();
    const name = (s?.name ?? "").toString().trim();
    const mcpUrl = (s?.mcpUrl ?? "").toString().trim();
    const enabled = Boolean(s?.enabled);

    const cat = normaliseCategory((s?.category ?? "").toString());
    if (!id || !name || !mcpUrl || !enabled || !cat) continue;

    out.push({
      id,
      name,
      category: cat,
      domain: (s?.domain ?? "").toString().trim() || undefined,
      mcpUrl,
      enabled,
      weight: typeof s?.weight === "number" ? s.weight : 100,
      tags: Array.isArray(s?.tags) ? s.tags.map((x: any) => String(x)) : []
    });
  }

  return out;
}

export function pickStoresForCategory(stores: StoreEntry[], category: StoreCategory, n = 3): StoreEntry[] {
  const filtered = stores.filter(s => s.enabled && s.category === category);

  // stable shuffle by weight, simple approach
  const weighted = filtered
    .map(s => ({ s, w: Math.max(1, s.weight ?? 100) }))
    .sort((a, b) => b.w - a.w);

  return weighted.slice(0, n).map(x => x.s);
}
