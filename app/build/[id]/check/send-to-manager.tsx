'use client';

import { useState } from 'react';
import { courseApi } from '../../api';

// Under each "explain it in your own words" question on the Check page: send
// staff answers to their nearest manager in Messages. Saves straight away and
// doesn't send the lesson back for review (it changes who sees answers, not the
// question).
export function SendToManager({ lessonId, promptId, on }: { lessonId: string; promptId: string; on: boolean }) {
  const [checked, setChecked] = useState(on);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await courseApi({ action: 'written.send', lesson_id: lessonId, prompt_id: promptId, on: next });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? 'Could not save. Try again.' });
    setChecked(next);
    setMsg({ ok: true, text: 'Saved.' });
  }

  return (
    <div className="mt-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={checked}
          disabled={busy}
          onChange={(e) => change(e.target.checked)}
        />
        <span>
          <span className="block font-medium">Send answers to their manager</span>
          <span className="block text-gray-600">
            Each answer goes to the person&apos;s nearest manager as a message, with an email to let them know (or to
            the admins if nobody manages that store). Staff are told before they answer. Applies to new answers from
            now on.
          </span>
        </span>
      </label>
      {busy && <p className="pl-6 text-gray-500">Saving...</p>}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`pl-6 ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
