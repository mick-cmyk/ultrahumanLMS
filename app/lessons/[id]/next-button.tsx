import Link from 'next/link';
import { Thumb } from '@/components/thumb';

export type NextStep = {
  href: string;
  /** Big button text: "Next video", "Next lesson" or "Finish course". */
  label: string;
  /** The line beside it: what comes next. */
  title: string;
  /** Small heading above that line: "Up next" or "All done". */
  eyebrow: string;
  /** Thumbnail of the next video, when there is one. */
  image?: string | null;
};

// The big "go to the next one" button, with what comes next beside it. Used
// in the quiz result and again at the bottom of the lesson page.
export function NextButton({ next }: { next: NextStep }) {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <Link
        href={next.href}
        className="inline-flex min-h-14 shrink-0 items-center justify-center rounded-lg bg-brand px-8 py-3 text-lg font-semibold text-brand-fg shadow-sm hover:opacity-90 sm:min-w-[14rem]"
      >
        {next.label} <span aria-hidden="true">&nbsp;&rarr;</span>
      </Link>
      {next.image && <Thumb src={next.image} play className="hidden w-28 shrink-0 sm:block" />}
      <p className="min-w-0 text-sm">
        <span className="block text-xs font-medium uppercase tracking-wide opacity-75">{next.eyebrow}</span>
        <span className="block font-medium">{next.title}</span>
      </p>
    </div>
  );
}
