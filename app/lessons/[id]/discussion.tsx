'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from '@/app/messages/api';

export type Post = {
  id: string;
  parent_id: string | null;
  body: string | null;
  hidden: boolean;
  author_name: string;
  author_role: string | null;
  unit_id: string;
  unit_name: string;
  created_at: string;
  pinned: boolean;
  reported: boolean;
  mine: boolean;
  can_moderate: boolean;
};

const ROLE: Record<string, string> = { manager: 'Manager', admin: 'Head office' };
const field = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';

// Talk about this lesson with your own store or branch. Managers above see
// every store they look after, labelled, so they can join in and moderate.
export function Discussion({ lessonId, posts, placed, showStores }: { lessonId: string; posts: Post[]; placed: boolean; showStores: boolean }) {
  const top = posts.filter((p) => !p.parent_id);
  const replies = (id: string) => posts.filter((p) => p.parent_id === id);

  return (
    <section className="space-y-4 rounded border border-gray-200 p-4" aria-labelledby="discussion-heading">
      <div>
        <h2 id="discussion-heading" className="font-medium">
          Talk about it with your team
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {showStores
            ? 'You can see posts from the stores you look after. Staff only see their own store\'s posts.'
            : 'Share a tip or ask how others handle it. Only people in your store or branch and your managers can see this.'}
        </p>
      </div>

      {placed ? (
        <Composer lessonId={lessonId} />
      ) : (
        <p className="text-sm text-gray-600">You need to be placed in a store or branch to post here.</p>
      )}

      {top.length === 0 ? (
        <p className="text-sm text-gray-500">No posts yet. Be the first.</p>
      ) : (
        <ul className="space-y-4">
          {top.map((p) => (
            <li key={p.id} className="space-y-2">
              <PostItem post={p} showStore={showStores} />
              <ul className="ml-4 space-y-2 border-l-2 border-gray-200 pl-3 sm:ml-6">
                {replies(p.id).map((r) => (
                  <li key={r.id}>
                    <PostItem post={r} showStore={false} />
                  </li>
                ))}
                {!p.hidden && (
                  <li>
                    <ReplyBox lessonId={lessonId} parentId={p.id} />
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PostItem({ post: p, showStore }: { post: Post; showStore: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [reported, setReported] = useState(false);

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError('');
    const r = await messagesApi(body);
    if (!r.ok) return setError(r.error);
    if (body.action === 'report') setReported(true);
    router.refresh();
  }

  if (p.hidden) {
    return <p className="text-sm italic text-gray-500">This post was taken down.</p>;
  }
  return (
    <div className={`rounded p-3 ${p.pinned ? 'border border-brand bg-brand-soft' : 'bg-gray-50'}`}>
      <p className="mb-1 text-xs text-gray-600">
        <span className="font-medium text-gray-800">{p.mine ? 'You' : p.author_name}</span>
        {p.author_role && ROLE[p.author_role] ? ` (${ROLE[p.author_role]})` : ''}
        {showStore ? `, ${p.unit_name}` : ''}, {when(p.created_at)}
        {p.pinned && <span className="ml-2 font-medium text-brand-ink">Pinned</span>}
        {p.reported && <span className="ml-2 rounded-full bg-amber-100 px-2 text-amber-800">Reported</span>}
      </p>
      <p className="whitespace-pre-line">{p.body}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {p.mine && (
          <button type="button" onClick={() => act({ action: 'moderate', id: p.id, what: 'remove' }, 'Delete your post?')} className="underline">
            Delete
          </button>
        )}
        {!p.mine && !p.can_moderate && (
          reported ? (
            <span className="text-gray-500">Reported. A manager will look at it.</span>
          ) : (
            <button
              type="button"
              onClick={() => act({ action: 'report', id: p.id }, 'Report this post to a manager?')}
              className="text-gray-600 underline"
            >
              Report
            </button>
          )
        )}
        {p.can_moderate && (
          <>
            <button type="button" onClick={() => act({ action: 'moderate', id: p.id, what: p.pinned ? 'unpin' : 'pin' })} className="underline">
              {p.pinned ? 'Unpin' : 'Pin as a good answer'}
            </button>
            {!p.mine && (
              <button
                type="button"
                onClick={() => act({ action: 'moderate', id: p.id, what: 'hide' }, 'Take this post down?')}
                className="text-red-700 underline"
              >
                Take down
              </button>
            )}
            {p.reported && (
              <button type="button" onClick={() => act({ action: 'moderate', id: p.id, what: 'clear' })} className="underline">
                It&apos;s fine, keep it
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Composer({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await messagesApi({ action: 'discussion', lesson: lessonId, body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={post} className="space-y-2">
      <label className="sr-only" htmlFor={`post-${lessonId}`}>
        Write a post
      </label>
      <textarea
        id={`post-${lessonId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Share a tip, or ask how others handle it..."
        className={field}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !body.trim()}
        className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Posting...' : 'Post'}
      </button>
    </form>
  );
}

function ReplyBox({ lessonId, parentId }: { lessonId: string; parentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-brand-ink underline">
        Reply
      </button>
    );
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await messagesApi({ action: 'discussion', lesson: lessonId, body, parent: parentId });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody('');
    setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={post} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        aria-label="Your reply"
        autoFocus
        className={field}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Posting...' : 'Reply'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
