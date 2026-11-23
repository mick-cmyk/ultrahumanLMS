import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadCourseTree } from '@/lib/course-tree';
import { buildExportPlan } from '@/lib/scorm/export-plan';
import { getBrand, getBrandTokens } from '@/brands';
import { textOn } from '@/brands/colour';
import { bunnyCdnHost } from '@/lib/bunny';

// The course content and video addresses for a SCORM export (admin only).
// Read with the admin's own session: quizzes are admin-only under RLS. The
// browser then fetches the videos and builds the zip itself.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  const { id } = await params;
  const tree = await loadCourseTree(await createClient(), id);
  if (!tree) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

  const firstBunnyVideo =
    tree.modules.flatMap((m) => m.lessons).find((l) => l.bunny_video_id)?.bunny_video_id ?? null;
  const accent = getBrandTokens(getBrand()).brand;
  const plan = buildExportPlan(tree, {
    cdnHost: await bunnyCdnHost(firstBunnyVideo),
    accent,
    accentText: textOn(accent),
  });
  return NextResponse.json(plan, { headers: { 'cache-control': 'no-store' } });
}
