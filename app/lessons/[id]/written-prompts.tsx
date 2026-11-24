'use client';

import { useEffect, useState } from 'react';

type Prompt = {
  id: string;
  prompt: string;
  max_words: number | null;
  /** The answer goes to their nearest manager in Messages. */
  send_to_manager?: boolean;
  /** Set just after this answer was sent on (this visit only). */
  just_sent?: boolean;
  answer: string | null;
  model_answer: string | null;
};

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// Teach-back: explain the idea in your own words. Not marked. The model answer
// only appears after you've committed yours, and your answer can't be changed
// after that, so it's a real attempt rather than a copy.
export function WrittenPrompts({ lessonId, unlocked }: { lessonId: string; unlocked: boolean }) {
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/written?lesson_id=${lessonId}`);
        const body = await res.json();
        if (!cancelled) setPrompts(Array.isArray(body.prompts) ? body.prompts : []);
      } catch {
        if (!cancelled) setError('Could not load this part. Refresh to try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, lessonId]);

  if (!unlocked) return null;
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!prompts || prompts.length === 0) return null;

  return (
    <section className="space-y-4 rounded border border-gray-200 p-4">
      <div>
        <h2 className="font-medium">Explain it in your own words</h2>
        <p className="mt-1 text-sm text-gray-600">
          Not marked. Write it the way you&apos;d say it to someone at work. Once you send it you&apos;ll
          see how we&apos;d put it.
        </p>
      </div>
      {prompts.map((p) => (
        <PromptItem
          key={p.id}
          lessonId={lessonId}
          prompt={p}
          onSaved={(next) => setPrompts((all) => (all ?? []).map((x) => (x.id === next.id ? next : x)))}
        />
      ))}
    </section>
  );
}

function PromptItem({
  lessonId,
  prompt,
  onSaved,
}: {
  lessonId: string;
  prompt: Prompt;
  onSaved: (p: Prompt) => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = words(draft);
  const over = prompt.max_words != null && count > prompt.max_words;
  const inputId = `written-${prompt.id}`;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || over) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/written', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: lessonId, prompt_id: prompt.id, answer: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not save that. Try again.');
        return;
      }
      onSaved({ ...prompt, answer: body.answer, model_answer: body.model_answer ?? null, just_sent: body.sent_to_manager === true });
    } catch {
      setError('Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (prompt.answer != null) {
    return (
      <div className="space-y-2">
        <p className="font-medium">{prompt.prompt}</p>
        <div className="rounded bg-gray-50 p-3 text-sm">
          <p className="text-gray-600">You wrote:</p>
          <p className="mt-1 whitespace-pre-line">{prompt.answer}</p>
        </div>
        {prompt.send_to_manager && (
          <p className="text-sm text-gray-600">
            {prompt.just_sent ? 'Sent to your manager. ' : 'This answer went to your manager. '}
            Any reply shows in{' '}
            <a href="/messages" className="text-brand-ink underline">
              Messages
            </a>
            .
          </p>
        )}
        {prompt.model_answer && (
          <div className="rounded border border-green-500 bg-green-50 p-3 text-sm">
            <p className="text-green-800">How we&apos;d put it:</p>
            <p className="mt-1 whitespace-pre-line">{prompt.model_answer}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={send} className="space-y-2">
      <label htmlFor={inputId} className="block font-medium">
        {prompt.prompt}
      </label>
      {prompt.send_to_manager && (
        <p className="text-sm text-gray-600">Your answer will be sent to your manager.</p>
      )}
      <textarea
        id={inputId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        maxLength={4000}
        className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !draft.trim() || over}
          className="rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Send my answer'}
        </button>
        {prompt.max_words != null && (
          <span className={`text-sm ${over ? 'text-red-700' : 'text-gray-600'}`} aria-live="polite">
            {count} of {prompt.max_words} words
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
