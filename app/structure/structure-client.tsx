'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_LEVEL_LABELS, STATES, levelLabel, type Unit } from '@/lib/units';

type TreeUnit = Unit & { depth: number };

const KINDS = Object.keys(DEFAULT_LEVEL_LABELS);

async function post(body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/structure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

export function StructureClient({
  units,
  counts,
}: {
  units: TreeUnit[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const hasRoot = units.some((u) => u.parent_id === null);
  const [form, setForm] = useState({
    name: '',
    kind: hasRoot ? 'brand' : 'supplier',
    parent_id: '',
    state: '',
    suburb: '',
  });

  async function run(body: unknown) {
    setError('');
    const { ok, error } = await post(body);
    if (!ok) setError(error ?? 'Something went wrong.');
    else router.refresh();
    return ok;
  }

  const update = (id: string, values: Record<string, unknown>) =>
    run({ action: 'update', id, values });

  async function add() {
    if (!form.name.trim()) {
      setError('Give it a name.');
      return;
    }
    if (hasRoot && !form.parent_id) {
      setError('Choose where it sits.');
      return;
    }
    const ok = await run({
      action: 'create',
      values: {
        name: form.name,
        kind: form.kind,
        parent_id: form.parent_id,
        state: form.state,
        suburb: form.suburb,
      },
    });
    if (ok) setForm({ ...form, name: '', suburb: '' });
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Level</th>
              <th className="py-2 pr-4">State</th>
              <th className="py-2 pr-4">Moves under</th>
              <th className="py-2 pr-4">Branding</th>
              <th className="py-2 pr-4">People</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-gray-100 ${u.active ? '' : 'text-gray-400'}`}
              >
                <td className="py-2 pr-4" style={{ paddingLeft: `${u.depth * 1.25}rem` }}>
                  <input
                    defaultValue={u.name}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== u.name &&
                      update(u.id, { name: e.target.value })
                    }
                    className="rounded border border-gray-300 px-2 py-1"
                  />
                </td>
                <td className="py-2 pr-4">
                  <select
                    defaultValue={u.kind}
                    onChange={(e) => update(u.id, { kind: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1"
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {levelLabel(k)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  <select
                    defaultValue={u.state ?? ''}
                    onChange={(e) => update(u.id, { state: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1"
                  >
                    <option value="">None</option>
                    {STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-4">
                  {u.parent_id === null ? (
                    <span className="text-gray-400">Top</span>
                  ) : (
                    <select
                      defaultValue={u.parent_id}
                      onChange={(e) => update(u.id, { parent_id: e.target.value })}
                      className="max-w-[12rem] rounded border border-gray-300 px-2 py-1"
                    >
                      {units
                        .filter((p) => p.id !== u.id && !p.path.includes(u.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {'  '.repeat(p.depth)}
                            {p.name}
                          </option>
                        ))}
                    </select>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={u.logo_url ?? ''}
                      placeholder="Logo URL"
                      onBlur={(e) =>
                        (e.target.value || null) !== (u.logo_url ?? null) &&
                        update(u.id, { logo_url: e.target.value })
                      }
                      className="w-32 rounded border border-gray-300 px-2 py-1"
                    />
                    <input
                      type="color"
                      defaultValue={u.brand_color ?? '#111827'}
                      title="Brand colour"
                      onBlur={(e) =>
                        e.target.value !== (u.brand_color ?? '#111827') &&
                        update(u.id, { brand_color: e.target.value })
                      }
                      className="h-8 w-10 rounded border border-gray-300"
                    />
                  </div>
                </td>
                <td className="py-2 pr-4 text-gray-500">{counts[u.id] ?? 0}</td>
                <td className="py-2 pr-4">
                  <button
                    onClick={() => update(u.id, { active: !u.active })}
                    className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {u.active ? 'Switch off' : 'Switch on'}
                  </button>
                </td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-gray-500">
                  Nothing here yet. Add your supplier first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Add a unit</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {levelLabel(k)}
              </option>
            ))}
          </select>
          {hasRoot && (
            <select
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              className="max-w-[14rem] rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">Sits under...</option>
              {units.map((p) => (
                <option key={p.id} value={p.id}>
                  {'  '.repeat(p.depth)}
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">State (optional)</option>
            {STATES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <input
            value={form.suburb}
            onChange={(e) => setForm({ ...form, suburb: e.target.value })}
            placeholder="Suburb (optional)"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button onClick={add} className="rounded bg-brand hover:opacity-90 px-3 py-1 text-sm text-brand-fg">
            Add
          </button>
        </div>
        <p className="text-xs text-gray-500">
          The first unit you add is the top of the tree. Every other unit needs
          a parent.
        </p>
      </section>
    </div>
  );
}
