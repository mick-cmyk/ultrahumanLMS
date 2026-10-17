'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { levelLabel, type Unit } from '@/lib/units';

type Role = 'learner' | 'viewer' | 'manager' | 'admin';
type User = {
  id: string;
  full_name: string | null;
  email: string;
  role: Role;
  active: boolean;
  unit_id: string | null;
};
type TreeUnit = Unit & { depth: number };
type Scope = { user_id: string; unit_id: string };

const ROLES: Role[] = ['learner', 'viewer', 'manager', 'admin'];
const ROLE_HELP: Record<Role, string> = {
  learner: 'Does the training',
  viewer: 'Reads reports for the units chosen',
  manager: 'Reports, plus adds and removes staff in the units chosen',
  admin: 'Everything',
};

export function PeopleClient({
  me,
  users,
  units,
  scopes,
}: {
  me: string;
  users: User[];
  units: TreeUnit[];
  scopes: Scope[];
}) {
  const router = useRouter();
  const [unitFilter, setUnitFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const scopesByUser = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of scopes) m.set(s.user_id, [...(m.get(s.user_id) ?? []), s.unit_id]);
    return m;
  }, [scopes]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (!showInactive && !u.active) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (unitFilter) {
        const unit = u.unit_id ? unitById.get(u.unit_id) : undefined;
        // A unit filter includes everything beneath it.
        if (!unit || !unit.path.includes(unitFilter)) return false;
      }
      return true;
    });
  }, [users, showInactive, roleFilter, unitFilter, unitById]);

  async function update(
    id: string,
    patch: {
      active?: boolean;
      role?: Role;
      unit_id?: string | null;
      add_scope?: string;
      remove_scope?: string;
    }
  ) {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch('/api/people/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (res.ok) router.refresh();
      else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not save that change.');
      }
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
      setImportMsg(`Imported: ${body.created} created, ${body.updated} updated.${failedNote}`);
      setCsv('');
      router.refresh();
    } catch {
      setImportMsg('Import failed.');
    } finally {
      setImporting(false);
    }
  }

  const unitOption = (u: TreeUnit) => (
    <option key={u.id} value={u.id}>
      {'  '.repeat(u.depth)}
      {u.name} ({levelLabel(u.kind)})
    </option>
  );

  return (
    <div className="space-y-6">
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <details className="rounded border border-gray-200 p-4">
        <summary className="cursor-pointer font-medium">Import from CSV</summary>
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-600">
            Columns: <code>email, full_name, unit</code>. The unit is the name
            shown on the Structure page. Re-importing an email moves and
            updates that person rather than duplicating them. Roles are never
            changed by an import.
          </p>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={5}
            placeholder={'email,full_name,unit\njo@example.com,Jo Blogs,Chadstone'}
            className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
          />
          <button
            onClick={runImport}
            disabled={importing || !csv.trim()}
            className="rounded bg-brand hover:opacity-90 px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
          {importMsg && <p className="text-sm text-gray-700">{importMsg}</p>}
        </div>
      </details>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Where</span>
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">Everywhere</option>
            {units.map(unitOption)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-500">Role</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Where</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const mine = scopesByUser.get(u.id) ?? [];
              const usesScope = u.role === 'viewer' || u.role === 'manager';
              return (
                <tr
                  key={u.id}
                  className={`border-b border-gray-100 align-top ${u.active ? '' : 'text-gray-400'}`}
                >
                  <td className="py-2 pr-4">{u.full_name ?? '-'}</td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.unit_id ?? ''}
                      disabled={busyId === u.id}
                      onChange={(e) => update(u.id, { unit_id: e.target.value || null })}
                      className="max-w-[14rem] rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="">Not placed</option>
                      {units.map(unitOption)}
                    </select>
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      value={u.role}
                      disabled={busyId === u.id || u.id === me}
                      onChange={(e) => update(u.id, { role: e.target.value as Role })}
                      title={ROLE_HELP[u.role]}
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {usesScope && (
                      <div className="mt-2 space-y-1">
                        <div className="text-xs text-gray-500">Can see:</div>
                        <div className="flex flex-wrap gap-1">
                          {mine.map((unitId) => (
                            <button
                              key={unitId}
                              onClick={() => update(u.id, { remove_scope: unitId })}
                              disabled={busyId === u.id}
                              title="Remove"
                              className="rounded-full border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                            >
                              {unitById.get(unitId)?.name ?? unitId} ✕
                            </button>
                          ))}
                          {mine.length === 0 && (
                            <span className="text-xs text-amber-700">
                              Nothing yet, so they see no one.
                            </span>
                          )}
                        </div>
                        <select
                          value=""
                          disabled={busyId === u.id}
                          onChange={(e) => e.target.value && update(u.id, { add_scope: e.target.value })}
                          className="rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Add a unit...</option>
                          {units.filter((x) => !mine.includes(x.id)).map(unitOption)}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => update(u.id, { active: !u.active })}
                      disabled={busyId === u.id || u.id === me}
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
