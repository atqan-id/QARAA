/**
 * Per-session serialized volatile storage.
 *
 * @license Apache-2.0
 */

import type { SessionRecord, SessionStore } from './store.ts';
import { SessionRecordExistsError, SessionRecordNotFoundError } from './store.ts';

export class MemorySessionStore implements SessionStore {
  readonly #records = new Map<string, SessionRecord>();
  readonly #tails = new Map<string, Promise<void>>();

  #enqueue<Result>(sessionId: string, operation: () => Result | Promise<Result>): Promise<Result> {
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(sessionId, tail);
    void tail.then(() => {
      if (this.#tails.get(sessionId) === tail) this.#tails.delete(sessionId);
    });
    return result;
  }

  async create(record: SessionRecord): Promise<void> {
    await this.#enqueue(record.sessionId, () => {
      if (this.#records.has(record.sessionId)) {
        throw new SessionRecordExistsError(record.sessionId);
      }
      this.#records.set(record.sessionId, record);
    });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    await (this.#tails.get(sessionId) ?? Promise.resolve());
    return this.#records.get(sessionId) ?? null;
  }

  update(
    sessionId: string,
    mutate: (record: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord> {
    return this.#enqueue(sessionId, () => {
      const current = this.#records.get(sessionId);
      if (!current) throw new SessionRecordNotFoundError(sessionId);
      const updated = mutate(current);
      this.#records.set(sessionId, updated);
      return updated;
    });
  }

  delete(sessionId: string): Promise<boolean> {
    return this.#enqueue(sessionId, () => this.#records.delete(sessionId));
  }
}
