// What a brand file must provide. Everything the product says or shows about
// itself comes from one of these, so a new brand is one new file plus the
// NEXT_PUBLIC_BRAND setting. Per-retailer logos and colours (the units in the
// tree) are separate and live in the database.

/**
 * Welcome page wording. The brand file holds the starting wording; admins can
 * change it on the Settings page (stored in site_text, shape checked there).
 */
export type WelcomeText = {
  heading: string;
  /** Up to five short paragraphs explaining what the visitor has found. */
  intro: string[];
  /** Up to five numbered steps. */
  steps: { title: string; body: string }[];
  /** Line under the login box; empty hides it. */
  newHere: string;
  /** Line linking to links.website; empty prompt hides it. */
  websitePrompt: string;
  websiteLinkText: string;
};

export type BrandConfig = {
  /** Short key, matches the file name and NEXT_PUBLIC_BRAND. */
  id: string;
  /** Product name shown in the header, page titles and emails. */
  name: string;
  /** One line under the name on the login page and in metadata. */
  tagline: string;
  /** The one colour everything else is derived from. Six-digit hex. */
  primaryColor: string;
  /** Absolute or site-relative logo URL, or null to show the name as text. */
  logoUrl: string | null;
  /** Optional square brand mark for the public landing page. Site-relative is fine. */
  markUrl?: string | null;
  /**
   * A client deployment's front page. When set, logged-out visitors see a
   * short welcome (logo, what this site is, log in) instead of the product
   * pitch the demo uses.
   */
  welcome?: WelcomeText & {
    /** Wide logo for the top of the page. Site-relative is fine. */
    logoUrl: string;
  };
  supportEmail: string | null;
  links: { website?: string; help?: string; privacy?: string; terms?: string };
  voice: {
    /** What the delayed re-test is called to staff, lower case: "quick check". */
    checkName: string;
    /** Last line of emails: "The Octolab team". */
    emailSignoff: string;
  };
  /** Display names for each level of the unit tree. */
  levelLabels: Record<string, string>;
  /** Friendly name on the from line of emails. */
  emailFromName: string;
};
