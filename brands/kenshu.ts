import type { BrandConfig } from './types';

// The Kenshu testing and demo site (lms.kenshu.com.au).
// primaryColor is the Kenshu LMS signal orange (see the Kenshu LMS design system).
// app, emails and login template follow after `npm run brand:build`.
const kenshu: BrandConfig = {
  id: 'kenshu',
  name: 'Kenshu',
  tagline: 'Short training that sticks.',
  primaryColor: '#ED4E05',
  logoUrl: null,
  supportEmail: null,
  links: { website: 'https://kenshu.com.au' },
  voice: {
    checkName: 'quick check',
    emailSignoff: 'The Kenshu team',
  },
  levelLabels: {
    supplier: 'Supplier',
    brand: 'Retail brand',
    region: 'Training manager or state rep',
    store: 'Store',
  },
  emailFromName: 'Kenshu Training',
};

export default kenshu;
