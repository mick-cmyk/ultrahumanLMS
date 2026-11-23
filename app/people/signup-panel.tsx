'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { levelLabel, type Unit } from '@/lib/units';

type TreeUnit = Unit & { depth: number; signup_code?: string | null };

// Self-registration settings (admins): the general sign-up page, auto-approve,
// and a sign-up link (with a QR code for a poster) for any place.
export function SignupPanel({
  units,
  general,
  autoApprove,
  pendingCount,
  approverCount,
}: {
  units: TreeUnit[];
  general: boolean;
  autoApprove: boolean;
  pendingCount: number;
  approverCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newLinkUnit, setNewLinkUnit] = useState('');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  async function call(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/registrations', {
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

  const linked = units.filter((u) => u.signup_code);
  const open = general || linked.length > 0;

  return (
    <details className="rounded border border-gray-200 p-4" open={pendingCount > 0}>
      <summary className="cursor-pointer font-medium">
        Self sign-up{' '}
        <span className="font-normal text-gray-600">
          ({open ? (autoApprove ? 'open, approved automatically' : 'open, needs approval') : 'off'})
        </span>
      </summary>
      <div className="mt-4 space-y-5">
        {pendingCount > 0 && (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
            {pendingCount} {pendingCount === 1 ? 'person is' : 'people are'} waiting for approval.{' '}
            <a href="/approvals" className="font-medium underline">
              Review them
            </a>
          </p>
        )}

        <div className="space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={general}
              disabled={busy}
              onChange={(e) => call({ action: 'settings', general: e.target.checked, auto_approve: autoApprove }, 'Saved.')}
            />
            <span>
              <span className="block font-medium">General sign-up page</span>
              <span className="block text-sm text-gray-600">
                Anyone can open {origin ? `${origin}/register` : '/register'} and choose where they work from a list of
                every place. The login page also shows a link to it.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={autoApprove}
              disabled={busy}
              onChange={(e) => call({ action: 'settings', general, auto_approve: e.target.checked }, 'Saved.')}
            />
            <span>
              <span className="block font-medium">Approve automatically</span>
              <span className="block text-sm text-gray-600">
                On: everyone who signs up gets in straight away. Off: an approver has to tick them in first.
              </span>
            </span>
          </label>
          {!autoApprove && approverCount === 0 && (
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
              Nobody is an approver yet, so requests will wait with nobody told. Tick &quot;Approver&quot; next to a manager or
              admin in the list below.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="font-medium">Sign-up links for a place</h3>
            <p className="text-sm text-gray-600">
              A link (or QR code for a staff-room poster) that signs people up straight into one place. Works even when the
              general page is off.
            </p>
          </div>
          {linked.length > 0 && (
            <ul className="space-y-3">
              {linked.map((u) => (
                <LinkRow
                  key={u.id}
                  unit={u}
                  url={`${origin}/register/${u.signup_code}`}
                  busy={busy}
                  onNew={() => {
                    if (confirm(`Make a new link for ${u.name}? The old link and any posters of it will stop working.`))
                      call({ action: 'link', unit_id: u.id, on: true }, `New link made for ${u.name}.`);
                  }}
                  onOff={() => {
                    if (confirm(`Turn off the sign-up link for ${u.name}?`))
                      call({ action: 'link', unit_id: u.id, on: false }, `Link for ${u.name} turned off.`);
                  }}
                />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <select
              value={newLinkUnit}
              onChange={(e) => setNewLinkUnit(e.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-surface px-3 py-2 text-sm"
              aria-label="Place for a new sign-up link"
            >
              <option value="">Choose a place...</option>
              {units
                .filter((u) => u.active && !u.signup_code)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {'  '.repeat(u.depth)}
                    {u.name} ({levelLabel(u.kind)})
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={busy || !newLinkUnit}
              onClick={() => {
                const u = units.find((x) => x.id === newLinkUnit);
                call({ action: 'link', unit_id: newLinkUnit, on: true }, `Link made for ${u?.name ?? 'that place'}.`);
                setNewLinkUnit('');
              }}
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            >
              Make link
            </button>
          </div>
        </div>

        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </details>
  );
}

function LinkRow({
  unit,
  url,
  busy,
  onNew,
  onOff,
}: {
  unit: TreeUnit;
  url: string;
  busy: boolean;
  onNew: () => void;
  onOff: () => void;
}) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!url.startsWith('http')) return;
    QRCode.toDataURL(url, { margin: 1, width: 512 }).then(setQr).catch(() => setQr(''));
  }, [url]);

  const small = 'min-h-11 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50';
  return (
    <li className="flex flex-wrap items-center gap-4 rounded border border-gray-200 p-3">
      {qr && (
        // White backing so the code scans in dark mode too.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt={`QR code for the ${unit.name} sign-up link`} className="h-24 w-24 rounded bg-white p-1" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium">{unit.name}</div>
        <code className="block break-all text-sm text-gray-700">{url}</code>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={small}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* clipboard blocked: the link is on screen to copy by hand */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {qr && (
            <a className={`${small} inline-flex items-center`} href={qr} download={`sign-up-${unit.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}>
              Download QR code
            </a>
          )}
          <button type="button" className={small} disabled={busy} onClick={onNew}>
            New link
          </button>
          <button type="button" className={`${small} text-red-700`} disabled={busy} onClick={onOff}>
            Turn off
          </button>
        </div>
      </div>
    </li>
  );
}
