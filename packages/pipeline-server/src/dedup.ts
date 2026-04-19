/**
 * @file dedup.ts
 * In-memory mutex for preventing duplicate pipeline dispatches for the same ticket.
 *
 * When a webhook fires for a ticket that is already being dispatched (e.g. two rapid
 * label changes on the same issue), `TicketMutex.acquire` returns false for the second
 * caller, which the dispatcher treats as deduplicated and drops. The lock is released
 * in the dispatcher's finally block once the pipeline run is actually started.
 */

/** Tracks in-flight ticket dispatches so rapid duplicate webhooks don't double-run. */
export class TicketMutex {
  private locks = new Set<string>();

  private key(productId: string, ticketKey: string): string {
    return `${productId}::${ticketKey}`;
  }

  /** Returns true if the lock was acquired; false if already held. */
  acquire(productId: string, ticketKey: string): boolean {
    const k = this.key(productId, ticketKey);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  release(productId: string, ticketKey: string): void {
    this.locks.delete(this.key(productId, ticketKey));
  }
}
