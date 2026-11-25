import type { BrandConfig } from './types';

// Electrolux deployment (GitHub copy mick-cmyk/EHP-Training-LMS). Colour is the
// navy from Electrolux's master logo (RGB file, #041E50). Logos are the
// horizontal master files from their brand guidelines: blue for the light
// theme, white for the dark theme. Still to confirm: the site address, a
// support address for training questions, and privacy/terms links.
const electrolux: BrandConfig = {
  id: 'electrolux',
  name: 'Electrolux Training',
  tagline: 'Product training for retail teams.',
  primaryColor: '#041E50',
  logoUrl: null,
  // Welcome page: the starting wording. Admins change it on the site
  // (Settings page); "Put back the original" there returns to this.
  welcome: {
    logoUrl: '/brand/electrolux-logo.png',
    logoDarkUrl: '/brand/electrolux-logo-white.png',
    heading: 'Welcome to Electrolux Training',
    intro: [
      'This is where retail staff who sell Electrolux learn the range, from laundry to kitchen, so you can answer customer questions with confidence.',
      'Your store or manager sets you up. Then you log in with your work email, no password needed.',
    ],
    steps: [
      { title: 'Watch', body: 'A short video on your phone, wherever suits you.' },
      { title: 'Answer', body: 'A few quick questions straight after.' },
      { title: 'Remember', body: 'A few days later, a quick check arrives by email to help it stick.' },
    ],
    newHere: 'New here? Your manager adds you, then you can log in with your work email.',
    websitePrompt: 'Looking to buy?',
    websiteLinkText: 'Visit electrolux.com.au',
  },
  supportEmail: null,
  links: { website: 'https://www.electrolux.com.au/' },
  voice: {
    checkName: 'quick check',
    emailSignoff: 'The Electrolux training team',
  },
  levelLabels: {
    supplier: 'Electrolux',
    brand: 'Retail brand',
    region: 'Training manager or state rep',
    store: 'Store',
    team: 'Team',
  },
  emailFromName: 'Electrolux Training',
};

export default electrolux;
