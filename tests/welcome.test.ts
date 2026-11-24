import { describe, expect, it } from 'vitest';
import { defaultWelcome, resolveWelcome, tidyWelcome, welcomeProblem, type WelcomeText } from '@/lib/welcome';

const good: WelcomeText = {
  heading: 'Welcome',
  intro: ['One.'],
  steps: [{ title: 'Watch', body: 'A video.' }],
  newHere: '',
  websitePrompt: '',
  websiteLinkText: '',
};

describe('welcome wording', () => {
  it('accepts good wording and the defaults', () => {
    expect(welcomeProblem(good)).toBeNull();
    expect(welcomeProblem(defaultWelcome())).toBeNull();
    expect(welcomeProblem({ ...good, intro: [], steps: [] })).toBeNull();
  });

  it('refuses bad wording with a plain message', () => {
    expect(welcomeProblem({ ...good, heading: ' ' })).toMatch(/heading/);
    expect(welcomeProblem({ ...good, intro: ['ok', ''] })).toMatch(/Paragraph 2/);
    expect(welcomeProblem({ ...good, intro: Array(6).fill('x') })).toMatch(/5 paragraphs/);
    expect(welcomeProblem({ ...good, steps: [{ title: 'x', body: '' }] })).toMatch(/Step 1/);
    expect(welcomeProblem({ ...good, heading: 'A — B' })).toMatch(/long dash/);
    expect(welcomeProblem({ ...good, websitePrompt: 'Buy?' })).toMatch(/link text/);
    expect(welcomeProblem({ ...good, extra: 1 })).toMatch(/unexpected/);
    expect(welcomeProblem(null)).not.toBeNull();
  });

  it('uses saved wording only when it is valid', () => {
    expect(resolveWelcome(good)).toMatchObject({ custom: true, show: true, text: good });
    expect(resolveWelcome({ heading: '' }).custom).toBe(false);
    expect(resolveWelcome(null).text).toEqual(defaultWelcome());
  });

  it('trims stray spaces', () => {
    expect(tidyWelcome({ ...good, heading: '  Hi ', steps: [{ title: ' a', body: 'b ' }] })).toMatchObject({
      heading: 'Hi',
      steps: [{ title: 'a', body: 'b' }],
    });
  });
});
