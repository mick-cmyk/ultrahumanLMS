'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mt-10 space-y-3 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-gray-600">
        We couldn&apos;t load that just now. It&apos;s usually temporary.
      </p>
      <button
        onClick={reset}
        className="rounded bg-brand hover:opacity-90 px-4 py-2 font-medium text-brand-fg"
      >
        Try again
      </button>
    </div>
  );
}
