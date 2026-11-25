'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Welcome } from '@/components/welcome';
import { WELCOME_LIMITS as L, welcomeProblem, type WelcomeText } from '@/lib/welcome';
import { NotSaved, useUnsavedWarning } from '@/lib/unsaved';

const input = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';
const btn = 'min-h-11 rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const primary = 'min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50';
const label = 'block text-sm font-medium';
const hint = 'block text-sm text-gray-500';

// Edit the welcome page wording, with a live preview underneath.
export function WelcomeEditor({
  initial,
  defaults,
  custom,
  brandHasWelcome,
  logoUrl,
}: {
  initial: WelcomeText;
  defaults: WelcomeText;
  custom: boolean;
  brandHasWelcome: boolean;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [w, setW] = useState<WelcomeText>(initial);
  const [isCustom, setIsCustom] = useState(custom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const dirty = JSON.stringify(w) !== JSON.stringify(initial);
  useUnsavedWarning(dirty);

  const set = (patch: Partial<WelcomeText>) => {
    setW((cur) => ({ ...cur, ...patch }));
    setSaved('');
  };
  const setPara = (i: number, v: string) => set({ intro: w.intro.map((p, j) => (j === i ? v : p)) });
  const setStep = (i: number, k: 'title' | 'body', v: string) =>
    set({ steps: w.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });

  async function send(body: object, done: string) {
    setBusy(true);
    setError('');
    setSaved('');
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(j.error ?? 'Could not save. Check your connection and try again.');
      return false;
    }
    setSaved(done);
    router.refresh();
    return true;
  }

  async function save() {
    const problem = welcomeProblem(w);
    if (problem) return setError(problem);
    if (await send({ action: 'welcome.save', welcome: w }, 'Saved. The welcome page now shows this wording.')) setIsCustom(true);
  }

  async function reset() {
    if (!window.confirm('Put back the original wording? Your changes here will be lost.')) return;
    if (await send({ action: 'welcome.reset' }, 'The original wording is back.')) {
      setW(defaults);
      setIsCustom(false);
    }
  }

  return (
    <section className="space-y-6 rounded border border-gray-200 p-4" aria-labelledby="welcome-heading">
      <div>
        <h2 id="welcome-heading" className="font-semibold">
          Welcome page
        </h2>
        <p className="text-sm text-gray-600">
          What people see at the front of the site before they log in. The preview at the bottom updates as you type.
        </p>
        {!brandHasWelcome && !isCustom && (
          <p className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-900">
            Visitors see the full product page at the moment. Saving here switches the site to this shorter welcome
            page. Use &quot;Put back the original&quot; to switch back.
          </p>
        )}
      </div>

      <label className="block space-y-1">
        <span className={label}>Heading</span>
        <input className={input} value={w.heading} maxLength={L.heading} onChange={(e) => set({ heading: e.target.value })} />
      </label>

      <fieldset className="space-y-2">
        <legend className={label}>Paragraphs under the heading</legend>
        <span className={hint}>What this site is and who it is for. Short is best.</span>
        {w.intro.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              className={input}
              rows={3}
              value={p}
              maxLength={L.paragraph}
              aria-label={`Paragraph ${i + 1}`}
              onChange={(e) => setPara(i, e.target.value)}
            />
            <button type="button" className={btn} onClick={() => set({ intro: w.intro.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {w.intro.length < L.paragraphs && (
          <button type="button" className={btn} onClick={() => set({ intro: [...w.intro, ''] })}>
            Add a paragraph
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={label}>Numbered steps</legend>
        <span className={hint}>How the training works, in a few words each.</span>
        {w.steps.map((s, i) => (
          <div key={i} className="grid gap-2 rounded border border-gray-200 p-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start">
            <input
              className={input}
              value={s.title}
              maxLength={L.stepTitle}
              aria-label={`Step ${i + 1} title`}
              placeholder="Title"
              onChange={(e) => setStep(i, 'title', e.target.value)}
            />
            <input
              className={input}
              value={s.body}
              maxLength={L.stepBody}
              aria-label={`Step ${i + 1} words`}
              placeholder="A few words"
              onChange={(e) => setStep(i, 'body', e.target.value)}
            />
            <button type="button" className={btn} onClick={() => set({ steps: w.steps.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {w.steps.length < L.steps && (
          <button type="button" className={btn} onClick={() => set({ steps: [...w.steps, { title: '', body: '' }] })}>
            Add a step
          </button>
        )}
      </fieldset>

      <label className="block space-y-1">
        <span className={label}>Line under the login box</span>
        <span className={hint}>Leave empty to hide it.</span>
        <input className={input} value={w.newHere} maxLength={L.newHere} onChange={(e) => set({ newHere: e.target.value })} />
      </label>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className={`${label} sm:col-span-2`}>Website line</legend>
        <span className={`${hint} sm:col-span-2`}>
          A small line under the login box that links to the brand website. Leave both empty to hide it.
        </span>
        <label className="block space-y-1">
          <span className="block text-sm">Words before the link</span>
          <input
            className={input}
            value={w.websitePrompt}
            maxLength={L.websitePrompt}
            placeholder="Looking to buy?"
            onChange={(e) => set({ websitePrompt: e.target.value })}
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm">Link text</span>
          <input
            className={input}
            value={w.websiteLinkText}
            maxLength={L.websiteLinkText}
            placeholder="Visit our website"
            onChange={(e) => set({ websiteLinkText: e.target.value })}
          />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy || !dirty} onClick={save}>
          Save changes
        </button>
        <NotSaved dirty={dirty} />
        {dirty && (
          <button type="button" className={btn} disabled={busy} onClick={() => { setW(initial); setError(''); }}>
            Undo my edits
          </button>
        )}
        {isCustom && (
          <button type="button" className={btn} disabled={busy} onClick={reset}>
            Put back the original
          </button>
        )}
        {busy && <span className="text-sm text-gray-500">Saving...</span>}
        {saved && (
          <span role="status" className="text-sm text-green-700">
            {saved}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <div>
        <p className="text-sm font-medium">Preview</p>
        <div className="mt-2 rounded border border-dashed border-gray-300 px-4">
          <Welcome text={w} logoUrl={logoUrl} preview />
        </div>
      </div>
    </section>
  );
}
