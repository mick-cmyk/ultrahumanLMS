import { getBrand } from '@/brands';

// A client's wide logo. With a separate dark-theme file (brand.welcome.logoDarkUrl)
// it swaps files; without one it inverts the light logo, which suits black logos.
export function BrandLogo({ src, className }: { src: string; className: string }) {
  const brand = getBrand();
  const dark = brand.welcome?.logoUrl === src ? brand.welcome.logoDarkUrl : undefined;
  if (!dark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={brand.name} className={`${className} dark:invert`} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={brand.name} className={`${className} dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark} alt={brand.name} className={`${className} hidden dark:block`} />
    </>
  );
}
