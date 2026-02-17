// app/api/demo/_lib/storeRegistry.ts

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

// Stores that are enabled in the registry but currently fail MCP search parsing.
// This lets us keep the registry broad without editing JSON down.
const DEMO_EXCLUDE_IDS = new Set<string>([
  "allbirds"
]);

function normaliseCategory(raw: string): StoreCategory | null {
  const c = (raw || "").toLowerCase().trim();

  if (c === "sneakers" || c === "sneaker") return "sneakers";
  if (c === "outdoor" || c === "outdoors") return "outdoor";
  if (c === "cycling" || c === "cycle" || c === "bike") return "cycling";
  if (c === "pet" || c === "pets" || c === "pet supplies") return "pet";

  if (c.includes("sneak")) return "sneakers";
  if (c.includes("outdoor")) return "outdoor";
  if (c.includes("cycl")) return "cycling";
  if (c.includes("pet")) return "pet";

  return null;
}

// Stable-ish rotation so you don't always hit the first 3 stores.
// Changes hourly, deterministic across a given hour.
function rotationOffset(itemsLen: number): number {
  if (itemsLen <= 0) return 0;
  const now = new Date();
  const key = now.getUTCFullYear() * 1000000 + (now.getUTCMonth() + 1) * 10000 + now.getUTCDate() * 100 + now.getUTCHours();
  return Math.abs(key) % itemsLen;
}

function rotate<T>(arr: T[], offset: number): T[] {
  if (!arr.length) return arr;
  const o = ((offset % arr.length) + arr.length) % arr.length;
  if (o === 0) return arr;
  return arr.slice(o).concat(arr.slice(0, o));
}

function stripBom(s: string): string {
  // Removes UTF-8 BOM if present
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

export async function loadStoreRegistry(): Promise<StoreEntry[]> {
  const file = path.join(process.cwd(), "data", "mcp_stores.json");
  let txt = await fs.readFile(file, "utf-8");

  // Prevent the BOM JSON parse crash you hit earlier
  txt = stripBom(txt).trim();

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

    const tags = Array.isArray(s?.tags) ? s.tags.map((x: any) => String(x)) : [];
    // Optional: allow tags to disable stores from demo without removing them
    if (tags.includes("demo:off") || tags.includes("exclude-demo")) continue;

    out.push({
      id,
      name,
      category: cat,
      domain: (s?.domain ?? "").toString().trim() || undefined,
      mcpUrl,
      enabled,
      weight: typeof s?.weight === "number" ? s.weight : 100,
      tags
    });
  }

  return out;
}

export function pickStoresForCategory(stores: StoreEntry[], category: StoreCategory, n = 3): StoreEntry[] {
  const filtered = stores
    .filter((s) => s.enabled && s.category === category)
    .filter((s) => !DEMO_EXCLUDE_IDS.has((s.id || "").toLowerCase()));

  // Sort by weight, then by id so order is deterministic before rotation
  const weighted = filtered
    .map((s) => ({ s, w: Math.max(1, s.weight ?? 100) }))
    .sort((a, b) => {
      if (b.w !== a.w) return b.w - a.w;
      return a.s.id.localeCompare(b.s.id);
    })
    .map((x) => x.s);

  // Rotate so you naturally sample different stores over time
  const rotated = rotate(weighted, rotationOffset(weighted.length));

  return rotated.slice(0, n);
}
