import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Announcements, questions and discussions. Every action runs under the
// caller's own session; the database functions (20261126000100_messages.sql)
// decide who may do what, so this route only shapes input and errors.

type Body = { action?: string; [key: string]: unknown };

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = (v: unknown): string | null =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;

function ruleFrom(v: unknown) {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const ids = (x: unknown) => (Array.isArray(x) ? x.map(id).filter((y): y is string => Boolean(y)).slice(0, 500) : []);
  return {
    all: r.all === true,
    unit_ids: ids(r.unit_ids),
    states: [] as string[],
    include_user_ids: ids(r.include_user_ids),
    exclude_user_ids: ids(r.exclude_user_ids),
  };
}

// Database messages are written for people already (raise exception '...').
function friendly(message: string): string {
  if (/not allowed|permission denied/i.test(message)) return 'You can\'t do that.';
  if (/check constraint|violates/i.test(message)) return 'Check the title and message aren\'t empty or too long, and any link starts with https://.';
  const m = message.match(/^[a-z][^.]*$/i);
  return m ? message.charAt(0).toUpperCase() + message.slice(1) + '.' : 'Something went wrong. Try again.';
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let b: Body;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const supabase = await createClient();
  const run = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true, data });
  };

  switch (b.action) {
    // ------------------------------------------------------- announcements
    case 'reach':
      return run('announcement_reach', { p_rule: ruleFrom(b.rule) });
    case 'announce': {
      const title = str(b.title, 120);
      const body = str(b.body, 4000);
      if (!title || !body) return NextResponse.json({ error: 'Give it a title and a message.' }, { status: 400 });
      const link = str(b.link, 500);
      if (link && !/^https:\/\/\S+$/.test(link)) {
        return NextResponse.json({ error: 'Links need to start with https://' }, { status: 400 });
      }
      return run('post_announcement', {
        p_title: title,
        p_body: body,
        p_link: link || null,
        p_rule: ruleFrom(b.rule),
        p_label: str(b.label, 200) || null,
        p_important: b.important === true,
      });
    }
    case 'ack':
      return run('acknowledge_announcement', { p_id: id(b.id) });
    case 'read_all':
      return run('mark_announcements_read', {});
    case 'outstanding':
      return run('announcement_outstanding', { p_id: id(b.id) });
    case 'delete_announcement':
      return run('delete_announcement', { p_id: id(b.id) });

    // ------------------------------------------------------- questions
    case 'start_thread': {
      const title = str(b.title, 120);
      const body = str(b.body, 4000);
      if (!title || !body) return NextResponse.json({ error: 'Add a subject and a message.' }, { status: 400 });
      return run('start_thread', { p_title: title, p_body: body, p_about: id(b.about), p_lesson: id(b.lesson) });
    }
    case 'reply': {
      const body = str(b.body, 4000);
      if (!body) return NextResponse.json({ error: 'Write a message first.' }, { status: 400 });
      return run('reply_thread', { p_id: id(b.id), p_body: body });
    }
    case 'close':
      return run('close_thread', { p_id: id(b.id), p_closed: b.closed !== false });

    // ------------------------------------------------------- discussions
    case 'discussion': {
      const body = str(b.body, 2000);
      if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 });
      return run('post_discussion', { p_lesson: id(b.lesson), p_body: body, p_parent: id(b.parent) });
    }
    case 'report':
      return run('report_discussion_post', { p_id: id(b.id) });
    case 'moderate': {
      const action = str(b.what, 10);
      if (!['hide', 'unhide', 'pin', 'unpin', 'clear', 'remove'].includes(action)) {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }
      return run('moderate_discussion_post', { p_id: id(b.id), p_action: action });
    }
    case 'discussion_mode':
      return run('set_discussion_mode', { p_mode: b.mode === 'unit' ? 'unit' : 'off' });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
