'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi } from '../../api';

// The course's "must watch before the quiz" setting, also on the Check page so
// it can be changed without going back to editing. Saves as soon as it's
// ticked or unticked. Same setting as Course details on the editing page.
export function WatchSetting({ courseId, requireWatch }: { courseId: string; requireWatch: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(requireWatch);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await courseApi({ action: 'course.update', id: courseId, require_watch: next });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error ?? 'Could not save. Try again.' });
    setOn(next);
    setMsg({ ok: true, text: 'Saved.' });
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={on}
          disabled={busy}
          onChange={(e) => change(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">Staff must watch each video before its quiz</span>
          <span className="block text-sm text-gray-600">
            Ticked: the quiz opens once they&apos;ve watched 90% of the video. Not ticked: the video is optional and the
            quiz is open straight away. Changes straight away, even on a published course.
          </span>
        </span>
      </label>
      {busy && <p className="pl-7 text-sm text-gray-500">Saving...</p>}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`pl-7 text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
