export class LogTail<T> {
  private buf: T[] = [];
  constructor(private capacity: number) {}
  push(item: T): void {
    this.buf.push(item);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  drain(): T[] {
    return [...this.buf];
  }
}
