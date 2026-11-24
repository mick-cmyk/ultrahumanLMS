'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { levelLabel, unitPathLabel, type Unit } from '@/lib/units';

type Role = 'learner' | 'viewer' | 'manager' | 'admin';
type User = {
  id: string;
  full_name: string | null;
  email: string;
  role: Role;
  active: boolean;
  unit_id: string | null;
  is_approver: boolean;
  is_developer: boolean;
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
  developerWaiting = [],
}: {
  me: string;
  users: User[];
  units: TreeUnit[];
  scopes: Scope[];
  developerWaiting?: string[];
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
  const [openId, setOpenId] = useState<string | null>(null);

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
      const emailNote =
        body.created > 0
          ? body.emailed === body.created
            ? ' Each new person has been sent an email saying how to log in.'
            : ` ${body.emailed ?? 0} of ${body.created} welcome emails sent. Let the others know to log in with their email address.`
          : '';
      setImportMsg(`Imported: ${body.created} created, ${body.updated} updated.${emailNote}${failedNote}`);
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
        ? body.emailed
          ? `${name} has been added and sent an email saying how to log in.`
          : `${name} has been added. The welcome email didn't send, so let them know to log in with their email address on the login page.`
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

      <ul className="divide-y divide-gray-200 border-y border-gray-200">
        {filtered.map((u) => (
          <PersonRow
            key={u.id}
            user={u}
            isMe={u.id === me}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
            busy={busyId === u.id}
            units={units}
            unitById={unitById}
            scopes={scopesByUser.get(u.id) ?? []}
            update={(patch) => update(u.id, patch)}
            developerWaiting={developerWaiting.includes(u.id)}
          />
        ))}
        {filtered.length === 0 && <li className="py-3 text-sm text-gray-500">No one matches those filters.</li>}
      </ul>
    </div>
  );
}

type Patch = {
  active?: boolean;
  role?: Role;
  unit_id?: string | null;
  is_approver?: boolean;
  add_scope?: string;
  remove_scope?: string;
};

const ROLE_NAME: Record<Role, string> = { learner: 'Learner', viewer: 'Viewer', manager: 'Manager', admin: 'Admin' };

// One person: a short, readable summary line, and an Edit panel with each
// setting labelled and explained. Changes save as soon as they're made.
function PersonRow({
  user: u,
  isMe,
  open,
  onToggle,
  busy,
  units,
  unitById,
  scopes,
  update,
  developerWaiting,
}: {
  user: User;
  isMe: boolean;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  units: TreeUnit[];
  unitById: Map<string, TreeUnit>;
  scopes: string[];
  update: (patch: Patch) => void;
  developerWaiting: boolean;
}) {
  // The developer keeps the highest access: other admins can't change their role
  // or deactivate them, only ask them to give it up.
  const locked = u.is_developer && !isMe;
  const unit = u.unit_id ? unitById.get(u.unit_id) : undefined;
  const usesScope = u.role === 'viewer' || u.role === 'manager';
  const canApprove = u.role === 'manager' || u.role === 'admin';
  const place = (id: string) => {
    const x = unitById.get(id);
    return x ? `${x.name} (${levelLabel(x.kind)})` : 'Unknown place';
  };
  const option = (x: TreeUnit) => (
    <option key={x.id} value={x.id}>
      {'   '.repeat(x.depth)}
      {x.name} ({levelLabel(x.kind)})
    </option>
  );
  const field = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';
  const panelId = `person-${u.id}`;
  const path = unit ? unitPathLabel(unit, unitById) : '';

  return (
    <li className={u.active ? '' : 'text-gray-500'}>
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <div className="min-w-[12rem] flex-1">
          <div className="font-medium">
            {u.full_name ?? '-'}
            {isMe && <span className="ml-2 text-xs font-normal text-gray-500">(you)</span>}
          </div>
          <div className="break-all text-sm text-gray-600">{u.email}</div>
        </div>
        <div className="min-w-[10rem] flex-1 text-sm">
          {unit ? (
            <>
              <div>{unit.name}</div>
              <div className="text-xs text-gray-500">{levelLabel(unit.kind)}</div>
            </>
          ) : (
            <span className="text-amber-700">Not placed anywhere</span>
          )}
        </div>
        <div className="flex w-40 flex-wrap items-center gap-1 text-sm">
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 font-medium text-gray-800">{ROLE_NAME[u.role]}</span>
          {u.is_developer && (
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-fg">Developer</span>
          )}
          {canApprove && u.is_approver && (
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-ink">Approver</span>
          )}
          {!u.active && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">Deactivated</span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          {open ? 'Close' : 'Edit'}
        </button>
      </div>

      {/* Edit panel */}
      {open && (
        <div id={panelId} className="mb-4 grid gap-5 rounded border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Where they work</span>
            <span className="mb-2 block text-sm text-gray-600">Decides which courses reach them and whose reports they show in.</span>
            <select
              value={u.unit_id ?? ''}
              disabled={busy}
              onChange={(e) => update({ unit_id: e.target.value || null })}
              className={field}
            >
              <option value="">Not placed anywhere</option>
              {units.map(option)}
            </select>
            {path && <span className="mt-1 block text-xs text-gray-500">{path}</span>}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Role</span>
            <span className="mb-2 block text-sm text-gray-600">{ROLE_HELP[u.role]}.</span>
            <select
              value={u.role}
              disabled={busy || isMe || locked}
              onChange={(e) => update({ role: e.target.value as Role })}
              className={field}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAME[r]}
                </option>
              ))}
            </select>
            {isMe && <span className="mt-1 block text-xs text-gray-500">You can&apos;t change your own role.</span>}
          </label>

          {usesScope && (
            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">What they can see</span>
              <span className="mb-2 block text-sm text-gray-600">
                Each place includes everything under it.{u.role === 'manager' ? ' They can also add and remove staff there.' : ''}
              </span>
              {scopes.length === 0 ? (
                <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-800">
                  Nothing yet, so their reports are empty. Add a place below.
                </p>
              ) : (
                <ul className="mb-2 space-y-2">
                  {scopes.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-surface px-3 py-1">
                      <span className="text-sm">{place(id)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => update({ remove_scope: id })}
                        aria-label={`Remove ${unitById.get(id)?.name ?? 'this place'}`}
                        className="min-h-11 rounded px-3 text-sm text-red-700 hover:bg-gray-100"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <select
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && update({ add_scope: e.target.value })}
                aria-label="Add a place they can see"
                className={field}
              >
                <option value="">+ Add a place they can see...</option>
                {units.filter((x) => !scopes.includes(x.id)).map(option)}
              </select>
            </div>
          )}

          {canApprove && (
            <label className="flex items-start gap-3 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={u.is_approver}
                disabled={busy}
                onChange={(e) => update({ is_approver: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium">Approver</span>
                <span className="block text-sm text-gray-600">
                  Gets an email when someone signs up for a place they can see, and approves or declines them.
                </span>
              </span>
            </label>
          )}

          {u.is_developer && (
            <div className="sm:col-span-2">
              <DeveloperNote user={u} isMe={isMe} waiting={developerWaiting} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 sm:col-span-2">
            <button
              type="button"
              onClick={() => update({ active: !u.active })}
              disabled={busy || isMe || locked}
              className={`min-h-11 rounded border px-4 py-2 text-sm ${
                u.active ? 'border-gray-300 text-red-700 hover:bg-gray-100' : 'border-green-300 text-green-700 hover:bg-green-50'
              }`}
            >
              {u.active ? 'Deactivate' : 'Reactivate'}
            </button>
            <span className="text-sm text-gray-600">
              {u.active
                ? 'Deactivating stops them logging in and takes them out of reports. Their history is kept.'
                : 'Reactivating lets them log in again.'}
            </span>
            {busy && <span className="ml-auto text-sm text-gray-500">Saving...</span>}
          </div>
        </div>
      )}
    </li>
  );
}

// Shown in the developer's Edit panel. Other admins can only ask the developer to
// give up developer access; the developer decides (People page and email).
function DeveloperNote({ user: u, isMe, waiting }: { user: User; isMe: boolean; waiting: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (isMe) {
    return (
      <p className="rounded bg-brand-soft p-3 text-sm text-brand-ink">
        You&apos;re the developer. Nobody can change your role, deactivate you or remove your access unless you approve
        it.
      </p>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', developer_id: u.id, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: body.error ?? 'Could not send the request.' });
      else {
        setMsg({ ok: true, text: 'Sent. The developer has been emailed and can approve or decline it.' });
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded bg-brand-soft p-3 text-sm text-brand-ink">
      <p>
        <span className="font-medium">{u.full_name ?? u.email} is the developer.</span> Their role and access can&apos;t be
        changed or removed unless they approve it.
      </p>
      {waiting ? (
        <p>A request to remove their developer access is waiting for them to decide.</p>
      ) : open ? (
        <form onSubmit={send} className="space-y-2">
          <label className="block">
            <span className="mb-1 block font-medium">Why do you need their developer access removed?</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded border border-gray-300 bg-surface px-3 py-2 text-gray-900"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Sending...' : 'Send request to the developer'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 underline">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="underline">
          Ask the developer to give up developer access
        </button>
      )}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-green-800' : 'text-red-700'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
