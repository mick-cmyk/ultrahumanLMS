// A slim branded header band for an org — logo + name, with an optional accent
// colour bar. Renders nothing when the user has no org. Uses a plain <img> so
// any logo URL works without next/image remote-host config.
export type OrgBrand = {
  name: string | null;
  logo_url: string | null;
  brand_color: string | null;
} | null;

export function BrandBand({ org }: { org: OrgBrand }) {
  if (!org) return null;
  const accent = org.brand_color ?? '#111827';
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-gray-200">
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className="flex items-center gap-3 px-4 py-3">
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.name ?? 'Organisation logo'}
            className="h-8 max-w-[160px] object-contain"
          />
        ) : (
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            {(org.name ?? '?').charAt(0)}
          </span>
        )}
        <span className="text-sm font-medium text-gray-700">{org.name}</span>
      </div>
    </div>
  );
}
