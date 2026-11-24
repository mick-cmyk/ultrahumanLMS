import type { BrandConfig } from './types';

// Ultrahuman deployment (ultrahumantraining.com). Colour is the deep blue from
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
  welcome: {
    logoUrl: '/brand/ultrahuman-logo.svg',
    heading: 'Welcome to Ultrahuman Training',
    intro: [
      'This is where retail staff who sell Ultrahuman learn the products, like Ultrahuman Ring, so you can answer customer questions with confidence.',
      'Your store or manager sets you up. Then you log in with your work email, no password needed.',
    ],
  },
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
