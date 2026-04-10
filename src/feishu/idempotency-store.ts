export class IdempotencyStore {
  private readonly seen = new Set<string>();

  tryMark(key: string): boolean {
    if (this.seen.has(key)) {
      return false;
    }

    this.seen.add(key);
    return true;
  }
}
