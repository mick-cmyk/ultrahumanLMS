// Picks the brand for this deployment. Set NEXT_PUBLIC_BRAND to a key below;
// it defaults to 'kenshu'. To add a brand: copy brands/kenshu.ts, register it
// here, and set NEXT_PUBLIC_BRAND on that brand's Vercel project.

import kenshu from './kenshu';
import ultrahuman from './ultrahuman';
import { deriveTokens, isHex6, type BrandTokens } from './colour';
import type { BrandConfig } from './types';

const BRANDS: Record<string, BrandConfig> = { kenshu, ultrahuman };

export function getBrand(id: string | undefined = process.env.NEXT_PUBLIC_BRAND): BrandConfig {
  const key = id || 'kenshu';
  const brand = BRANDS[key];
  if (!brand) {
    throw new Error(
      `Unknown brand "${key}". Set NEXT_PUBLIC_BRAND to one of: ${Object.keys(BRANDS).join(', ')}.`
    );
  }
  if (!isHex6(brand.primaryColor)) {
    throw new Error(`Brand "${key}": primaryColor must be a six-digit hex like #0f766e.`);
  }
  return brand;
}

export function getBrandTokens(brand: BrandConfig = getBrand()): BrandTokens {
  return deriveTokens(brand.primaryColor);
}

/** Capitalise the first letter: "quick check" becomes "Quick check". */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const BRAND_IDS = Object.keys(BRANDS);
