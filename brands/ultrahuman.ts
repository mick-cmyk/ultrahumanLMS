import type { BrandConfig } from './types';

// Ultrahuman deployment (ultrahumantraining.au). Colour is the deep blue from
// ultrahuman.com's palette: their black (#111111) disappears on the app's dark
// theme, the blue works on both. Still to confirm with Ultrahuman: logo files,
// a support address for training questions, and privacy/terms links that
// cover this training site.
const ultrahuman: BrandConfig = {
  id: 'ultrahuman',
  name: 'Ultrahuman Training',
  tagline: 'Product training for retail teams.',
  primaryColor: '#112BAF',
  logoUrl: null,
  supportEmail: null,
  links: { website: 'https://www.ultrahuman.com/au/' },
  voice: {
    checkName: 'quick check',
    emailSignoff: 'The Ultrahuman training team',
  },
  levelLabels: {
    supplier: 'Ultrahuman',
    brand: 'Retail brand',
    region: 'Training manager or state rep',
    store: 'Store',
    team: 'Team',
  },
  emailFromName: 'Ultrahuman Training',
};

export default ultrahuman;
