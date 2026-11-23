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
  is_approver: boolean;
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
      is_approver?: boolean;
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

  // Add one person. /api/staff checks with the database that the caller may
  // place this email in this unit, then creates the login. A role other than
  // learner is applied only to someone brand new; an existing person's role is
  // never changed by adding them again (change it in the list instead).
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addUnit, setAddUnit] = useState('');
  const [addRole, setAddRole] = useState<Role>('learner');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setAddMsg(null);
    if (!addName.trim() || !addEmail.trim() || !addUnit) {
      setAddMsg({ ok: false, text: 'Fill in their name, email and where they work.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail.trim())) {
      setAddMsg({ ok: false, text: "That email address doesn't look right." });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', full_name: addName, email: addEmail, unit_id: addUnit }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddMsg({ ok: false, text: body.error ?? 'Could not add that person.' });
        return;
      }
      const name = addName.trim();
      let text = body.created
        ? `${name} has been added. They can log in with their email address on the login page.`
        : `${name} already had a login, so they have been moved here and switched on. Their role hasn't changed.`;
      if (body.created && addRole !== 'learner') {
        const steps: Record<string, unknown>[] = [{ role: addRole }];
        if (addRole === 'viewer' || addRole === 'manager') steps.push({ add_scope: addUnit });
        for (const step of steps) {
          const r = await fetch('/api/people/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: body.id, ...step }),
          });
          if (!r.ok) {
            text += ` Their role couldn't be set to ${addRole}, so they are a learner for now. Change it in the list below.`;
            break;
          }
        }
      }
      setAddMsg({ ok: true, text });
      setAddName('');
      setAddEmail('');
      setAddRole('learner');
      router.refresh();
    } catch {
      setAddMsg({ ok: false, text: 'Could not add that person.' });
    } finally {
      setAdding(false);
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

      <form onSubmit={addPerson} className="space-y-3 rounded border border-gray-200 p-4" noValidate>
        <div>
          <h2 className="font-medium">Add a person</h2>
          <p className="text-sm text-gray-600">
            They log in with this email address. No password needed.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Full name</span>
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              autoComplete="off"
              className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              autoComplete="off"
              className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Where they work</span>
            <select
              value={addUnit}
              onChange={(e) => setAddUnit(e.target.value)}
              className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
            >
              <option value="">Choose...</option>
              {units.filter((u) => u.active).map(unitOption)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Role</span>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as Role)}
              className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}: {ROLE_HELP[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(addRole === 'viewer' || addRole === 'manager') && (
          <p className="text-sm text-gray-600">
            They will see the place chosen above and everything under it. You can add more places in the list below.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={adding}
            className="rounded bg-brand hover:opacity-90 px-4 py-2 text-sm font-medium text-brand-fg disabled:opacity-50"
          >
            {adding ? 'Adding...' : 'Add person'}
          </button>
          {addMsg && (
            <p role="status" className={`text-sm ${addMsg.ok ? 'text-green-700' : 'text-red-700'}`}>
              {addMsg.text}
            </p>
          )}
        </div>
      </form>

      <details className="rounded border border-gray-200 p-4">
        <summary className="cursor-pointer font-medium">Import a list from CSV</summary>
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
              <th className="py-2 pr-4">Person</th>
              <th className="py-2 pr-4">Where</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const mine = scopesByUser.get(u.id) ?? [];
              const usesScope = u.role === 'viewer' || u.role === 'manager';
              return (
                <tr
                  key={u.id}
                  className={`border-b border-gray-100 align-top ${u.active ? '' : 'text-gray-500'}`}
                >
                  <td className="py-2 pr-4 align-top">
                    {/* Email under the name, so the table fits without scrolling sideways. */}
                    <span className="block font-medium">{u.full_name ?? '-'}</span>
                    <span className="block break-all text-xs text-gray-600">{u.email}</span>
                  </td>
                  <td className="py-2 pr-4 align-top">
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
                  <td className="py-2 pr-4 align-top">
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
                    {(u.role === 'manager' || u.role === 'admin') && (
                      <label
                        className="mt-2 flex items-center gap-2 text-xs"
                        title="Approvers are emailed about sign-up requests for the places they can see, and approve them."
                      >
                        <input
                          type="checkbox"
                          checked={u.is_approver}
                          disabled={busyId === u.id}
                          onChange={(e) => update(u.id, { is_approver: e.target.checked })}
                        />
                        Approver
                      </label>
                    )}
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
                          className="w-full max-w-[14rem] rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Add a unit...</option>
                          {units.filter((x) => !mine.includes(x.id)).map(unitOption)}
                        </select>
                      </div>
                    )}
                  </td>
                  <td className="py-2 align-top">
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
                <td colSpan={4} className="py-3 text-gray-500">
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
