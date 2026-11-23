'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type ScheduleRow = {
  assignment_id: string | null;
  course_title: string;
  label: string | null;
  send_after: string;
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// "New course" emails from the last 30 days: what's waiting, what's gone, and
// the hourly limit that paces them.
export function EmailSchedule({ rows, hourlyLimit }: { rows: ScheduleRow[]; hourlyLimit: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [limit, setLimit] = useState(String(hourlyLimit));

  async function call(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/course-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: b.error ?? 'Something went wrong.' });
      else {
        setMsg({ ok: true, text: ok });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-t border-gray-200 pt-6">
      <div>
        <h2 className="text-lg font-semibold">&quot;New course&quot; emails</h2>
        <p className="text-sm text-gray-600">
          Emails go out in batches every 10 minutes, at most {hourlyLimit} an hour, so a big list never uses up the
          email allowance at once. The rest wait for the next hour.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">No course emails in the last 30 days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Course</th>
                <th className="py-2 pr-4">Sends from</th>
                <th className="py-2 pr-4">Waiting</th>
                <th className="py-2 pr-4">Sent</th>
                <th className="py-2 pr-4">Not sent</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.assignment_id}-${r.send_after}`} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    {r.course_title}
                    {r.label && <span className="block text-xs text-gray-500">{r.label}</span>}
                  </td>
                  <td className="py-2 pr-4">{when(r.send_after)}</td>
                  <td className="py-2 pr-4">{r.queued}</td>
                  <td className="py-2 pr-4">{r.sent}</td>
                  <td className="py-2 pr-4" title="Skipped (left, or no longer assigned) or failed after three tries">
                    {r.skipped + r.failed}
                  </td>
                  <td className="py-2 pr-4">
                    {r.queued > 0 && r.assignment_id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Cancel the ${r.queued} emails still waiting for ${r.course_title}? The course stays assigned.`))
                            call({ action: 'cancel', assignment_id: r.assignment_id }, 'Cancelled the emails still waiting.');
                        }}
                        className="min-h-11 rounded border border-gray-300 px-3 py-1.5 text-red-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          call({ action: 'limit', limit: Number(limit) }, 'Hourly limit saved.');
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium">Emails per hour, at most</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-32 rounded border border-gray-300 bg-surface px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy || Number(limit) === hourlyLimit}
          className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Save
        </button>
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
            {msg.text}
          </p>
        )}
      </form>
    </section>
  );
}
