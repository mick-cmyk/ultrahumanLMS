import { isHex6, textOn } from '@/brands/colour';

// A slim branded header band for the user's retail brand: logo + name, with an
// accent colour bar. Renders nothing when there is no branding to show. Uses a
// plain <img> so any logo URL works without next/image remote-host config.
export type OrgBrand = {
  name: string | null;
  logo_url: string | null;
  brand_color: string | null;
} | null;

export function BrandBand({ org }: { org: OrgBrand }) {
  if (!org) return null;
  // brand_color is data entered per retailer; anything that isn't a plain
  // six-digit hex falls back, and the initial's colour is picked for contrast
  // (white on JB yellow would be unreadable).
  const accent = org.brand_color && isHex6(org.brand_color) ? org.brand_color : '#111827';
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-gray-200">
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className="flex items-center gap-3 px-4 py-3">
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.name ?? 'Brand logo'}
            className="h-8 max-w-[160px] object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded font-semibold"
            style={{ backgroundColor: accent, color: textOn(accent) }}
          >
            {(org.name ?? '?').charAt(0)}
          </span>
        )}
        <span className="text-sm font-medium text-gray-700">{org.name}</span>
      </div>
    </div>
  );
}
