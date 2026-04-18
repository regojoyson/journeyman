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
