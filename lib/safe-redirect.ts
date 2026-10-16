// Only allow same-site relative paths for the post-login `next` parameter.
// Anything else (absolute URLs, protocol-relative "//host", backslash tricks,
// control characters) falls back to the home page. Prevents an open redirect
// after a successful login.
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  try {
    const base = 'http://internal.invalid';
    if (new URL(next, base).origin !== base) return '/';
  } catch {
    return '/';
  }
  return next;
}
