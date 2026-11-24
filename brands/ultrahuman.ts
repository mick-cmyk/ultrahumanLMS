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
  // ---------------------------------------------------------------------
  // WELCOME PAGE TEXT (what people see before they log in).
  // Change only the words inside the quote marks. For an apostrophe inside
  // your text, use the curly one: you’ll, it’s (a straight ' would end the
  // line early; the deploy command catches that and stops). No em dashes.
  // Then run:
  //   npm run welcome:deploy
  // ---------------------------------------------------------------------
  welcome: {
    logoUrl: '/brand/ultrahuman-logo.svg',
    heading: 'Welcome to Ultrahuman Training',
    // One line per paragraph. Add or remove lines as you like.
    intro: [
      'This is where retail staff who sell Ultrahuman learn the products, like Ultrahuman Ring, so you can answer customer questions with confidence.',
      'Your store or manager sets you up. Then you log in with your work email, no password needed.',
    ],
    // The numbered steps.
    steps: [
      { title: 'Watch', body: 'A short video on your phone, wherever suits you.' },
      { title: 'Answer', body: 'A few quick questions straight after.' },
      { title: 'Remember', body: 'A few days later, a quick check arrives by email to help it stick.' },
    ],
    // Under the login box.
    newHere: 'New here? Your manager adds you, then you can log in with your work email.',
    // Small line linking to the website above. Leave as '' to hide it.
    websitePrompt: 'Looking to buy?',
    websiteLinkText: 'Visit ultrahuman.com',
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
