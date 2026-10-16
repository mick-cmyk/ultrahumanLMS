// Helpers for the unit tree. The database maintains `path` (ancestor ids from
// the root down to the unit itself), so everything here is a plain read.

export type Unit = {
  id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  state: string | null;
  suburb: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  path: string[];
  active: boolean;
};

// Default display names for each level. The brand file will override these per
// deployment; an unknown kind falls back to a tidied version of the key.
export const DEFAULT_LEVEL_LABELS: Record<string, string> = {
  supplier: 'Supplier',
  brand: 'Retail brand',
  region: 'Region',
  store: 'Store',
};

export function levelLabel(kind: string, labels: Record<string, string> = DEFAULT_LEVEL_LABELS): string {
  if (labels[kind]) return labels[kind];
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;

// Units in tree order (parents before children, siblings by name), each with
// its depth. Anything whose parent is not in the list (a viewer only sees part
// of the tree) is treated as a root of its own.
export function orderTree<T extends Pick<Unit, 'id' | 'parent_id' | 'name'>>(
  units: T[]
): (T & { depth: number })[] {
  const ids = new Set(units.map((u) => u.id));
  const kids = new Map<string | null, T[]>();
  for (const u of units) {
    const key = u.parent_id && ids.has(u.parent_id) ? u.parent_id : null;
    const list = kids.get(key) ?? [];
    list.push(u);
    kids.set(key, list);
  }
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = (kids.get(parent) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const u of list) {
      out.push({ ...u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// "Harbour Electrics > Victoria > Chadstone" for a unit, skipping the root.
export function unitPathLabel(unit: Pick<Unit, 'path'>, byId: Map<string, Pick<Unit, 'name'>>): string {
  return unit.path
    .slice(1)
    .map((id) => byId.get(id)?.name)
    .filter(Boolean)
    .join(' > ');
}
