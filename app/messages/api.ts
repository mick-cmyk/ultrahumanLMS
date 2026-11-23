// Client helper for /api/messages.
export async function messagesApi<T = unknown>(
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? 'Something went wrong. Try again.' };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

export function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  if (days < 1 && new Date().getDate() === d.getDate()) return `Today ${time}`;
  if (days < 2) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}
