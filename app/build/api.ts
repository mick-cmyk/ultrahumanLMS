// Browser helper for the course builder's single API route.
export async function courseApi(
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  try {
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ...data, ok: res.ok, error: res.ok ? undefined : (data.error ?? 'Something went wrong.') };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// 125 -> "2:05"
export function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// "2:05", "2m 5s", "125" -> 125. Blank -> null. Anything else -> NaN.
export function parseDuration(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  let m = s.match(/^(\d+):([0-5]?\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d+)\s*m(?:in)?s?)?\s*(?:(\d+)\s*s(?:ec)?s?)?$/i);
  if (m && (m[1] || m[2])) return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  if (/^\d+$/.test(s)) return Number(s);
  return NaN;
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
