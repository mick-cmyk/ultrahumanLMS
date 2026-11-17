import type { BrandConfig } from './types';

// The Octolab testing and demo site (lms.octolab.com.au, confirmed 18 Nov 2026).
// primaryColor is the orange carried over from the old Kenshu demo; swap it if
// Octolab's site palette says otherwise. The logo is in public/brand/octolab-logo.png;
// logoUrl stays null until lms.octolab.com.au is live, because emails need an
// absolute URL (set it to https://lms.octolab.com.au/brand/octolab-logo.png then).
// app, emails and login template follow after `npm run brand:build`.
const octolab: BrandConfig = {
  id: 'octolab',
  name: 'Octolab',
  tagline: 'Short training that sticks.',
  primaryColor: '#ED4E05',
  logoUrl: null,
  supportEmail: null,
  links: { website: 'https://octolab.com.au' },
  voice: {
    checkName: 'quick check',
    emailSignoff: 'The Octolab team',
  },
  levelLabels: {
    supplier: 'Supplier',
    brand: 'Retail brand',
    region: 'Training manager or state rep',
    store: 'Store',
  },
  emailFromName: 'Octolab Training',
};

export default octolab;
