import type { BrandConfig } from './types';

// UltraHuman production deployment. PLACEHOLDERS: every value here needs
// confirming with UltraHuman before go-live (colour, logo, support address,
// links, wording).
const ultrahuman: BrandConfig = {
  id: 'ultrahuman',
  name: 'UltraHuman Training',
  tagline: 'Product training for retail teams.',
  primaryColor: '#111827',
  logoUrl: null,
  supportEmail: null,
  links: {},
  voice: {
    checkName: 'quick check',
    emailSignoff: 'The UltraHuman training team',
  },
  levelLabels: {
    supplier: 'UltraHuman',
    brand: 'Retail brand',
    region: 'Training manager or state rep',
    store: 'Store',
  },
  emailFromName: 'UltraHuman Training',
};

export default ultrahuman;
