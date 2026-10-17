'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { levelLabel } from '@/lib/units';

type Staff = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  active: boolean;
  unit_id: string | null;
  unit_label: string;
};
type Place = { id: string; name: string; kind: string; depth: number };

export function TeamClient({ staff, places }: { staff: Staff[]; places: Place[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [unitId, setUnitId] = useState(places[0]?.id ?? '');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setMsg('');
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', email, full_name: name, unit_id: unitId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg(body.error ?? 'Could not add that person.');
        return;
      }
      setMsg(body.created ? `Added ${name}.` : `${name} was already here, so they have been updated.`);
      setEmail('');
      setName('');
      router.refresh();
    } catch {
      setMsg('Could not add that person.');
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(s: Staff) {
    setBusyId(s.id);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: s.active ? 'deactivate' : 'reactivate', id: s.id }),
      });
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setMsg(body.error ?? 'Could not change that person.');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addPerson} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Where</span>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2"
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {'  '.repeat(p.depth)}
                {p.name} ({levelLabel(p.kind)})
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={adding || !unitId}
          className="rounded bg-brand hover:opacity-90 px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50"
        >
          {adding ? 'Adding...' : 'Add person'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Where</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-gray-100 ${s.active ? '' : 'text-gray-400'}`}
              >
                <td className="py-2 pr-4">{s.full_name ?? '-'}</td>
                <td className="py-2 pr-4">{s.email}</td>
                <td className="py-2 pr-4">{s.unit_label || '-'}</td>
                <td className="py-2 pr-4">{s.active ? 'Active' : 'Deactivated'}</td>
                <td className="py-2 pr-4">
                  <button
                    onClick={() => toggleActive(s)}
                    disabled={busyId === s.id}
                    className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {s.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-gray-500">
                  No one here yet. Add your first team member above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
