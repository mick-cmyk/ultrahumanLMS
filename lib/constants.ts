// The tunable constants of the learning engine, in one place (spec:
// "All configurable constants in one file, but these are the defaults").
//
// NOTE: the Postgres functions in supabase/migrations that need these values
// (record_quiz_attempt, the retest dispatch) take them as defaulted arguments
// seeded from here at call time, so this file stays the single source of
// truth. If you change a default that a SQL function also hardcodes as a
// fallback, update both — each such spot is commented in the migration.

/** Days from passing every quiz in a module to the first re-test being due. */
export const RETEST_DELAY_DAYS = 5;

/** Days added when a failed re-test is requeued. */
export const REQUEUE_DELAY_DAYS = 4;

/** How many re-test cycles before we stop nagging and flag the manager. */
export const RETEST_MAX_CYCLES = 3;

/** Days after a re-test email is sent before a single reminder goes out. */
export const REMINDER_DELAY_DAYS = 3;

/** Default quiz pass mark (fraction correct). */
export const DEFAULT_PASS_MARK = 0.8;

/** Default watch threshold (fraction of unique seconds seen). */
export const DEFAULT_WATCH_THRESHOLD = 0.9;

/** How many questions a re-test samples from the module pool. */
export const RETEST_QUESTION_COUNT = 4;
