// Welcome page wording: the brand file's starting text, or what an admin
// saved on the Settings page. The shape rules here match the database check
// (20261127000100_site_text.sql), which is the one that counts; these give
// the Settings page instant, friendly messages.

import { getBrand } from '@/brands';
import type { WelcomeText } from '@/brands/types';

export type { WelcomeText };

export const WELCOME_LIMITS = {
  heading: 200,
  paragraphs: 5,
  paragraph: 600,
  steps: 5,
  stepTitle: 60,
  stepBody: 300,
  newHere: 300,
  websitePrompt: 100,
  websiteLinkText: 100,
} as const;

// The brand file's wording. A brand without its own welcome (the demo, which
// shows the product page) still gets sensible text to start editing from.
export function defaultWelcome(): WelcomeText {
  const brand = getBrand();
  if (brand.welcome) {
    const { heading, intro, steps, newHere, websitePrompt, websiteLinkText } = brand.welcome;
    return { heading, intro, steps, newHere, websitePrompt, websiteLinkText };
  }
  return {
    heading: `Welcome to ${brand.name}`,
    intro: [
      'This is where you do your training. Short videos, a few questions, and nothing to remember: you log in from a link in your email.',
    ],
    steps: [
      { title: 'Watch', body: 'A short video on your phone, wherever suits you.' },
      { title: 'Answer', body: 'A few quick questions straight after.' },
      { title: 'Remember', body: `A few days later, a ${brand.voice.checkName} arrives by email to help it stick.` },
    ],
    newHere: 'New here? Your manager adds you, then you can log in with your work email.',
    websitePrompt: '',
    websiteLinkText: '',
  };
}

const isText = (v: unknown): v is string => typeof v === 'string';

// What is wrong with this wording, in plain words, or null if it's fine.
export function welcomeProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'The wording is not valid.';
  const w = v as Record<string, unknown>;
  const L = WELCOME_LIMITS;
  const known = ['heading', 'intro', 'steps', 'newHere', 'websitePrompt', 'websiteLinkText'];
  if (Object.keys(w).some((k) => !known.includes(k))) return 'The wording has something unexpected in it.';
  if (!isText(w.heading) || !w.heading.trim()) return 'The heading cannot be empty.';
  if (w.heading.length > L.heading) return `Keep the heading under ${L.heading} characters.`;
  if (!Array.isArray(w.intro) || w.intro.length > L.paragraphs) return `Use up to ${L.paragraphs} paragraphs.`;
  for (const [i, p] of w.intro.entries()) {
    if (!isText(p) || !p.trim()) return `Paragraph ${i + 1} is empty. Fill it in or remove it.`;
    if (p.length > L.paragraph) return `Paragraph ${i + 1} is too long (up to ${L.paragraph} characters).`;
  }
  if (!Array.isArray(w.steps) || w.steps.length > L.steps) return `Use up to ${L.steps} steps.`;
  for (const [i, s] of w.steps.entries()) {
    const step = s as Record<string, unknown> | null;
    if (!step || typeof step !== 'object' || Object.keys(step).some((k) => k !== 'title' && k !== 'body')) {
      return `Step ${i + 1} is not valid.`;
    }
    if (!isText(step.title) || !step.title.trim()) return `Step ${i + 1} needs a title.`;
    if (!isText(step.body) || !step.body.trim()) return `Step ${i + 1} needs some words under the title.`;
    if (step.title.length > L.stepTitle) return `Step ${i + 1}'s title is too long (up to ${L.stepTitle} characters).`;
    if (step.body.length > L.stepBody) return `Step ${i + 1}'s words are too long (up to ${L.stepBody} characters).`;
  }
  if (!isText(w.newHere) || w.newHere.length > L.newHere) return `Keep the line under the login box under ${L.newHere} characters.`;
  if (!isText(w.websitePrompt) || w.websitePrompt.length > L.websitePrompt) return 'The website line is too long.';
  if (!isText(w.websiteLinkText) || w.websiteLinkText.length > L.websiteLinkText) return 'The website link text is too long.';
  if (w.websitePrompt.trim() && !w.websiteLinkText.trim()) return 'Add the link text for the website line, or clear both.';
  if (JSON.stringify(w).includes('—')) return 'Take out the long dash. Use a comma, full stop or "to" instead.';
  return null;
}

// Trim the edges of every field, so stray spaces never reach the page.
export function tidyWelcome(w: WelcomeText): WelcomeText {
  return {
    heading: w.heading.trim(),
    intro: w.intro.map((p) => p.trim()),
    steps: w.steps.map((s) => ({ title: s.title.trim(), body: s.body.trim() })),
    newHere: w.newHere.trim(),
    websitePrompt: w.websitePrompt.trim(),
    websiteLinkText: w.websiteLinkText.trim(),
  };
}

// The wording to show: what an admin saved if it's valid, otherwise the brand
// file's. `show` says whether this site uses the welcome page at all: always
// once an admin has saved wording, otherwise only if the brand file has one.
export function resolveWelcome(saved: unknown): { text: WelcomeText; custom: boolean; show: boolean } {
  if (saved && welcomeProblem(saved) === null) return { text: saved as WelcomeText, custom: true, show: true };
  return { text: defaultWelcome(), custom: false, show: Boolean(getBrand().welcome) };
}

// The logo at the top of the welcome page, or null to show the name as text.
export function welcomeLogo(): string | null {
  const brand = getBrand();
  return brand.welcome?.logoUrl ?? brand.markUrl ?? brand.logoUrl ?? null;
}
