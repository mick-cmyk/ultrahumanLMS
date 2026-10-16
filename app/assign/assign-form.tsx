'use client';

import { useEffect, useMemo, useState } from 'react';

type Course = { id: string; title: string; published: boolean };
type Org = { id: string; name: string };
type Store = { id: string; name: string; state: string; org_id: string };
type User = {
  id: string;
  full_name: string | null;
  email: string;
  org_id: string | null;
  store_id: string | null;
};

const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

// Toggle a value's membership in a Set (returns a new Set).
function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function AssignForm({
  courses,
  orgs,
  stores,
  users,
}: {
  courses: Course[];
  orgs: Org[];
  stores: Store[];
  users: User[];
}) {
  const [courseId, setCourseId] = useState('');
  const [everyone, setEveryone] = useState(false);
  const [orgIds, setOrgIds] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Set<string>>(new Set());
  const [storeIds, setStoreIds] = useState<Set<string>>(new Set());
  const [includeIds, setIncludeIds] = useState<Set<string>>(new Set());
  const [excludeIds, setExcludeIds] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  const [dueDays, setDueDays] = useState('');
  const [search, setSearch] = useState('');

  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Stores available to pick: constrained to chosen orgs (if any).
  const visibleStores = useMemo(
    () => (orgIds.size === 0 ? stores : stores.filter((s) => orgIds.has(s.org_id))),
    [stores, orgIds]
  );

  const rule = useMemo(
    () => ({
      all: everyone,
      org_ids: everyone ? [] : [...orgIds],
      states: everyone ? [] : [...states],
      store_ids: everyone ? [] : [...storeIds],
      include_user_ids: [...includeIds],
      exclude_user_ids: [...excludeIds],
    }),
    [everyone, orgIds, states, storeIds, includeIds, excludeIds]
  );

  const ruleKey = JSON.stringify(rule);
  const hasTarget =
    everyone || orgIds.size > 0 || includeIds.size > 0;

  // Live reach, debounced.
  useEffect(() => {
    if (!hasTarget) {
      setReach(0);
      return;
    }
    setReachLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/assign/reach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule }),
        });
        const body = await res.json();
        setReach(res.ok ? body.reach : null);
      } catch {
        setReach(null);
      } finally {
        setReachLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // ruleKey captures every field of rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey, hasTarget]);

  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter(
        (u) =>
          (u.full_name ?? '').toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [search, users]);

  async function save() {
    if (!courseId) {
      setErrorMsg('Pick a course first.');
      setSaveStatus('error');
      return;
    }
    if (!hasTarget) {
      setErrorMsg('Add at least one target (everyone, an org, or an individual).');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: courseId,
          rule,
          label,
          due_days: dueDays ? Number(dueDays) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMsg(body.error ?? 'Could not save the assignment.');
        setSaveStatus('error');
        return;
      }
      setSaveStatus('saved');
    } catch {
      setErrorMsg('Could not save the assignment.');
      setSaveStatus('error');
    }
  }

  const nameOf = (id: string) => {
    const u = userById.get(id);
    return u ? (u.full_name ?? u.email) : id;
  };

  return (
    <div className="space-y-6">
      {/* Course */}
      <label className="block max-w-md">
        <span className="mb-1 block text-sm font-medium">Course</span>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        >
          <option value="">Choose a course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.published ? '' : ' (draft)'}
            </option>
          ))}
        </select>
      </label>

      {/* Everyone */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={everyone}
          onChange={(e) => setEveryone(e.target.checked)}
        />
        <span className="font-medium">Everyone</span>
        <span className="text-sm text-gray-500">(ignores the filters below)</span>
      </label>

      {!everyone && (
        <div className="grid gap-6 md:grid-cols-3">
          <Facet
            title="Orgs"
            onAll={() => setOrgIds(new Set(orgs.map((o) => o.id)))}
            onNone={() => setOrgIds(new Set())}
          >
            {orgs.map((o) => (
              <Check
                key={o.id}
                label={o.name}
                checked={orgIds.has(o.id)}
                onChange={() => setOrgIds((s) => toggle(s, o.id))}
              />
            ))}
          </Facet>

          <Facet
            title="States"
            hint="Filters stores within matched orgs"
            onAll={() => setStates(new Set(STATES))}
            onNone={() => setStates(new Set())}
          >
            {STATES.map((st) => (
              <Check
                key={st}
                label={st}
                checked={states.has(st)}
                onChange={() => setStates((s) => toggle(s, st))}
              />
            ))}
          </Facet>

          <Facet
            title="Stores"
            hint={orgIds.size ? 'Within chosen orgs' : 'Choose orgs to narrow'}
            onAll={() => setStoreIds(new Set(visibleStores.map((s) => s.id)))}
            onNone={() => setStoreIds(new Set())}
          >
            {visibleStores.map((s) => (
              <Check
                key={s.id}
                label={`${s.name} (${s.state})`}
                checked={storeIds.has(s.id)}
                onChange={() => setStoreIds((set) => toggle(set, s.id))}
              />
            ))}
          </Facet>
        </div>
      )}

      {/* Individuals */}
      <div className="space-y-2">
        <span className="text-sm font-medium">Individuals</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people to include or exclude…"
          className="w-full max-w-md rounded border border-gray-300 px-3 py-2"
        />
        {searchResults.length > 0 && (
          <ul className="max-w-md divide-y divide-gray-100 rounded border border-gray-200">
            {searchResults.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span>
                  {u.full_name ?? u.email}{' '}
                  <span className="text-gray-400">{u.email}</span>
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIncludeIds((s) => new Set(s).add(u.id));
                      setExcludeIds((s) => {
                        const n = new Set(s);
                        n.delete(u.id);
                        return n;
                      });
                    }}
                    className="rounded border border-green-300 px-2 py-0.5 text-green-700"
                  >
                    Include
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExcludeIds((s) => new Set(s).add(u.id));
                      setIncludeIds((s) => {
                        const n = new Set(s);
                        n.delete(u.id);
                        return n;
                      });
                    }}
                    className="rounded border border-red-300 px-2 py-0.5 text-red-700"
                  >
                    Exclude
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ChipRow
          label="Included"
          ids={[...includeIds]}
          nameOf={nameOf}
          onRemove={(id) =>
            setIncludeIds((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            })
          }
        />
        <ChipRow
          label="Excluded (always wins)"
          ids={[...excludeIds]}
          nameOf={nameOf}
          onRemove={(id) =>
            setExcludeIds((s) => {
              const n = new Set(s);
              n.delete(id);
              return n;
            })
          }
        />
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. JB VIC+NSW"
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Due days (optional)</span>
          <input
            type="number"
            min="1"
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
            placeholder="e.g. 14"
            className="w-32 rounded border border-gray-300 px-3 py-2"
          />
        </label>
      </div>

      {/* Reach + save */}
      <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-4">
        <p className="text-lg">
          {reachLoading ? (
            <span className="text-gray-400">Counting…</span>
          ) : reach === null ? (
            <span className="text-red-600">Couldn&apos;t work out the reach</span>
          ) : (
            <>
              This will reach{' '}
              <strong>
                {reach} {reach === 1 ? 'person' : 'people'}
              </strong>
              .
            </>
          )}
        </p>
        <button
          onClick={save}
          disabled={saveStatus === 'saving'}
          className="ml-auto rounded bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save assignment'}
        </button>
      </div>

      {saveStatus === 'saved' && (
        <p className="rounded bg-green-50 p-3 text-sm text-green-800">
          Assignment saved. It takes effect immediately — matching staff will see
          the course next time they open their training.
        </p>
      )}
      {saveStatus === 'error' && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{errorMsg}</p>
      )}
    </div>
  );
}

function Facet({
  title,
  hint,
  onAll,
  onNone,
  children,
}: {
  title: string;
  hint?: string;
  onAll: () => void;
  onNone: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="space-x-2 text-xs">
          <button type="button" onClick={onAll} className="text-gray-500 underline">
            All
          </button>
          <button type="button" onClick={onNone} className="text-gray-500 underline">
            None
          </button>
        </span>
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
        {children}
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function ChipRow({
  label,
  ids,
  nameOf,
  onRemove,
}: {
  label: string;
  ids: string[];
  nameOf: (id: string) => string;
  onRemove: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-500">{label}:</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onRemove(id)}
          className="rounded-full border border-gray-300 px-2 py-0.5 hover:bg-gray-50"
          title="Remove"
        >
          {nameOf(id)} ✕
        </button>
      ))}
    </div>
  );
}
