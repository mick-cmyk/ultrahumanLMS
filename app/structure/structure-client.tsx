'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Group = { id: string; name: string };
type Org = {
  id: string;
  name: string;
  type: string;
  group_id: string | null;
  logo_url: string | null;
  brand_color: string | null;
};
type Store = {
  id: string;
  name: string;
  state: string;
  suburb: string | null;
  org_id: string;
};

const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

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
  groups,
  orgs,
  stores,
}: {
  groups: Group[];
  orgs: Org[];
  stores: Store[];
}) {
  const router = useRouter();
  const [error, setError] = useState('');

  // New-entity form state.
  const [newGroup, setNewGroup] = useState('');
  const [newOrg, setNewOrg] = useState({ name: '', type: 'retailer', group_id: '' });
  const [newStore, setNewStore] = useState({ name: '', state: 'VIC', suburb: '', org_id: '' });

  async function run(body: unknown) {
    setError('');
    const { ok, error } = await post(body);
    if (!ok) setError(error ?? 'Something went wrong.');
    else router.refresh();
  }

  const groupName = (id: string | null) =>
    id ? (groups.find((g) => g.id === id)?.name ?? '—') : 'Direct (no group)';

  return (
    <div className="space-y-8">
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Groups */}
      <section className="space-y-2">
        <h2 className="font-medium">Groups</h2>
        <ul className="divide-y divide-gray-100 rounded border border-gray-200">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2 p-2">
              <input
                defaultValue={g.name}
                onBlur={(e) =>
                  e.target.value !== g.name &&
                  run({ action: 'update', entity: 'group', id: g.id, values: { name: e.target.value } })
                }
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </li>
          ))}
          {groups.length === 0 && <li className="p-2 text-sm text-gray-500">No groups yet.</li>}
        </ul>
        <div className="flex gap-2">
          <input
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="New group name"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            onClick={async () => {
              if (!newGroup.trim()) return;
              await run({ action: 'create', entity: 'group', values: { name: newGroup } });
              setNewGroup('');
            }}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white"
          >
            Add group
          </button>
        </div>
      </section>

      {/* Orgs */}
      <section className="space-y-2">
        <h2 className="font-medium">Orgs</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Group</th>
                <th className="py-2 pr-4">Branding</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <input
                      defaultValue={o.name}
                      onBlur={(e) =>
                        e.target.value !== o.name &&
                        run({ action: 'update', entity: 'org', id: o.id, values: { name: e.target.value } })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      defaultValue={o.type}
                      onChange={(e) =>
                        run({ action: 'update', entity: 'org', id: o.id, values: { type: e.target.value } })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="retailer">retailer</option>
                      <option value="client">client</option>
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      defaultValue={o.group_id ?? ''}
                      onChange={(e) =>
                        run({
                          action: 'update',
                          entity: 'org',
                          id: o.id,
                          values: { group_id: e.target.value },
                        })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="">Direct (no group)</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <input
                        defaultValue={o.logo_url ?? ''}
                        placeholder="Logo URL"
                        onBlur={(e) =>
                          (e.target.value || null) !== o.logo_url &&
                          run({ action: 'update', entity: 'org', id: o.id, values: { logo_url: e.target.value } })
                        }
                        className="w-40 rounded border border-gray-300 px-2 py-1"
                      />
                      <input
                        type="color"
                        defaultValue={o.brand_color ?? '#111827'}
                        title="Brand colour"
                        onBlur={(e) =>
                          e.target.value !== o.brand_color &&
                          run({ action: 'update', entity: 'org', id: o.id, values: { brand_color: e.target.value } })
                        }
                        className="h-8 w-10 rounded border border-gray-300"
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-gray-500">
                    No orgs yet. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={newOrg.name}
            onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            placeholder="New org name"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={newOrg.type}
            onChange={(e) => setNewOrg({ ...newOrg, type: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="retailer">retailer</option>
            <option value="client">client</option>
          </select>
          <select
            value={newOrg.group_id}
            onChange={(e) => setNewOrg({ ...newOrg, group_id: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">Direct (no group)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (!newOrg.name.trim()) return;
              await run({ action: 'create', entity: 'org', values: newOrg });
              setNewOrg({ name: '', type: 'retailer', group_id: '' });
            }}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white"
          >
            Add org
          </button>
        </div>
      </section>

      {/* Stores */}
      <section className="space-y-2">
        <h2 className="font-medium">Stores</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">State</th>
                <th className="py-2 pr-4">Suburb</th>
                <th className="py-2 pr-4">Org</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <input
                      defaultValue={s.name}
                      onBlur={(e) =>
                        e.target.value !== s.name &&
                        run({ action: 'update', entity: 'store', id: s.id, values: { name: e.target.value } })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      defaultValue={s.state}
                      onChange={(e) =>
                        run({ action: 'update', entity: 'store', id: s.id, values: { state: e.target.value } })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      {STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      defaultValue={s.suburb ?? ''}
                      onBlur={(e) =>
                        (e.target.value || null) !== s.suburb &&
                        run({ action: 'update', entity: 'store', id: s.id, values: { suburb: e.target.value } })
                      }
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="py-2 pr-4 text-gray-500">
                    {orgs.find((o) => o.id === s.org_id)?.name ?? '—'}
                  </td>
                </tr>
              ))}
              {stores.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-gray-500">
                    No stores yet. Add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={newStore.name}
            onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
            placeholder="New store name"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={newStore.state}
            onChange={(e) => setNewStore({ ...newStore, state: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {STATES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <input
            value={newStore.suburb}
            onChange={(e) => setNewStore({ ...newStore, suburb: e.target.value })}
            placeholder="Suburb"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={newStore.org_id}
            onChange={(e) => setNewStore({ ...newStore, org_id: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">Choose org…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            onClick={async () => {
              if (!newStore.name.trim() || !newStore.org_id) {
                setError('A store needs a name and an org.');
                return;
              }
              await run({ action: 'create', entity: 'store', values: newStore });
              setNewStore({ name: '', state: 'VIC', suburb: '', org_id: '' });
            }}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white"
          >
            Add store
          </button>
        </div>
      </section>
    </div>
  );
}
