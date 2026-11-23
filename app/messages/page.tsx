import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Announcements, type Announcement } from './announcements';
import { Questions, type ThreadRow, type Person } from './questions';
import { Moderation, type ReportedPost } from './moderation';
import { DiscussionSetting } from './discussion-setting';

export const metadata = { title: 'Messages' };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  const profile = await requireRole(['learner', 'viewer', 'manager', 'admin']);
  const { lesson } = await searchParams;
  const supabase = await createClient();
  const canPost = profile.role === 'admin' || profile.role === 'manager';

  const [{ data: announcements }, { data: threads }, { data: reported }, { data: mode }, { data: people }, lessonRow] =
    await Promise.all([
      supabase.rpc('my_announcements', { p_limit: 50 }),
      supabase.rpc('my_threads', { p_limit: 100 }),
      canPost ? supabase.rpc('reported_discussion_posts') : Promise.resolve({ data: [] }),
      profile.role === 'admin' ? supabase.rpc('discussion_mode') : Promise.resolve({ data: null }),
      // People a manager or admin can start a conversation with (RLS limits a
      // manager to their own area).
      canPost
        ? supabase.from('users').select('id, full_name, email, unit_id').eq('active', true).neq('id', profile.id).order('full_name')
        : Promise.resolve({ data: [] }),
      lesson && /^[0-9a-f-]{36}$/i.test(lesson)
        ? supabase.from('lessons').select('id, title').eq('id', lesson).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="text-gray-600">
            {canPost
              ? 'Updates for your team, and questions from them.'
              : 'Updates from head office and your managers, and questions you have asked.'}
          </p>
        </div>
        {canPost && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/messages/sent"
              className="inline-flex min-h-11 items-center rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Sent updates
            </Link>
            <Link
              href="/messages/announce"
              className="inline-flex min-h-11 items-center rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90"
            >
              Send an update
            </Link>
          </div>
        )}
      </div>

      {canPost && ((reported ?? []) as ReportedPost[]).length > 0 && <Moderation posts={reported as ReportedPost[]} />}

      <Announcements items={(announcements ?? []) as Announcement[]} />

      <Questions
        threads={(threads ?? []) as ThreadRow[]}
        role={profile.role}
        placed={Boolean(profile.unit_id)}
        people={(people ?? []) as Person[]}
        lesson={(lessonRow.data as { id: string; title: string } | null) ?? null}
      />

      {profile.role === 'admin' && <DiscussionSetting mode={(mode as string | null) ?? 'off'} />}
    </div>
  );
}
