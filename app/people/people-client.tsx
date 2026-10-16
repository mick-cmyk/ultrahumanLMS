'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Role = 'learner' | 'manager' | 'coordinator' | 'admin';
type User = {
  id: string;
  full_name: string | null;
  email: string;
  role: Role;
  active: boolean;
  org_id: string | null;
  store_id: string | null;
};
type Org = { id: string; name: string };
type Store = { id: string; name: string; state: string; org_id: string };

const ROLES: Role[] = ['learner', 'manager', 'coordinator', 'admin'];

export function PeopleClient({
  users,
  orgs,
  stores,
}: {
  users: User[];
  orgs: Org[];
  stores: Store[];
}) {
  const router = useRouter();
  const [orgFilter, setOrgFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const storesForState = useMemo(
    () => (stateFilter ? stores.filter((s) => s.state === stateFilter) : stores),
    [stores, stateFilter]
  );

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (!showInactive && !u.active) return false;
      if (orgFilter && u.org_id !== orgFilter) return false;
      if (storeFilter && u.store_id !== storeFilter) return false;
      if (stateFilter) {
        const st = u.store_id ? storeById.get(u.store_id) : undefined;
        if (!st || st.state !== stateFilter) return false;
      }
      return true;
    });
  }, [users, showInactive, orgFilter, storeFilter, stateFilter, storeById]);

  async function update(id: string, patch: { active?: boolean; role?: Role }) {
    setBusyId(id);
    try {
      const res = await fetch('/api/people/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportMsg('');
    try {
      const res = await fetch('/api/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const body = await res.json();
      if (!res.ok) {
        setImportMsg(body.error ?? 'Import failed.');
        return;
      }
      const failedNote =
        body.failed.length > 0
          ? ` ${body.failed.length} skipped (${body.failed
              .map((f: { email: string; error: string }) => `${f.email}: ${f.error}`)
              .join('; ')}).`
          : '';
      setImportMsg(
        `Imported: ${body.created} created, ${body.updated} updated.${failedNote}`
      );
      setCsv('');
      router.refresh();
    } catch {
      setImportMsg('Import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Import */}
      <details className="rounded border border-gray-200 p-4">
        <summary className="cursor-pointer font-medium">Import from CSV</summary>
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-600">
            Columns: <code>email, full_name, store</code>. Re-importing an email
            updates that person rather than duplicating them.
          </p>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={'email,full_name,store\njo@example.com,Jo Blogs,JB Hi-Fi Chadstone'}
            className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
          />
          <button
            onClick={runImport}
            disabled={importing || !csv.trim()}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
          {importMsg && <p className="text-sm text-gray-700">{importMsg}</p>}
        </div>
      </details>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Org</span>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">All orgs</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">State</span>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setStoreFilter('');
            }}
            className="rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">All states</option>
            {[...new Set(stores.map((s) => s.state))].sort().map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Store</span>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">All stores</option>
            {storesForState.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show deactivated
        </label>
        <span className="ml-auto text-sm text-gray-500">{filtered.length} people</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Org / Store</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const store = u.store_id ? storeById.get(u.store_id) : undefined;
              return (
                <tr
                  key={u.id}
                  className={`border-b border-gray-100 ${u.active ? '' : 'text-gray-400'}`}
                >
                  <td className="py-2 pr-4">{u.full_name ?? '—'}</td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    {u.org_id ? orgName.get(u.org_id) : '—'}
                    {store ? ` · ${store.name}` : ''}
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.role}
                      disabled={busyId === u.id}
                      onChange={(e) => update(u.id, { role: e.target.value as Role })}
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => update(u.id, { active: !u.active })}
                      disabled={busyId === u.id}
                      className={`rounded border px-2 py-1 text-xs ${
                        u.active
                          ? 'border-gray-300 hover:bg-gray-50'
                          : 'border-green-300 text-green-700 hover:bg-green-50'
                      }`}
                    >
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-gray-500">
                  No one matches those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
