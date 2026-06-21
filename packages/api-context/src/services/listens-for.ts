/**
 * Fail-closed allowlist check for a webhook trigger's `listensFor`.
 * Empty/undefined `listensFor` → allow any event. A non-empty list fires ONLY
 * when the event type is known and listed; an unknown (null/undefined) or
 * unlisted type is rejected.
 */
export function eventPassesListensFor(
  listensFor: string[] | undefined,
  eventType: string | null | undefined,
): boolean {
  if (!listensFor || listensFor.length === 0) return true;
  return !!eventType && listensFor.includes(eventType);
}
