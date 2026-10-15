/**
 * For RecordEditModal's onDelete: the modal closes once the promise it is
 * handed settles, and a rejected one escapes its click handler. This keeps a
 * failed delete's promise pending instead, so the modal stays open with the
 * mutation's error showing (pass `error={mutation.error?.message}`), and
 * nothing reaches the console as an unhandled rejection.
 */
export function keepOpenOnError<T>(p: Promise<T>): Promise<T> {
  return p.catch(() => new Promise<T>(() => {}))
}
