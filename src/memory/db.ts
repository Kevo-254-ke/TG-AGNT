import fs from 'node:fs';
import path from 'node:path';
import Datastore from 'nedb-promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../core/logger';
import type { StoredMessage, StoredSummary, StoredUser } from '../core/types';

const log = logger.child({ module: 'memory:db' });

/**
 * Pure-JS embedded database (NeDB) — no native builds, works out of the
 * box in Termux. Swappable later: everything in this class talks in
 * domain types (StoredUser/StoredMessage/StoredSummary), so migrating to
 * Postgres/SQLite down the line only means rewriting this one file.
 */
export class MemoryDatabase {
  readonly users: Datastore<StoredUser>;
  readonly messages: Datastore<StoredMessage>;
  readonly summaries: Datastore<StoredSummary>;

  /**
   * Resolves once index creation has settled (success or failure). Index
   * creation is a performance optimization, not a correctness requirement
   * — reads/writes work without it, just slower on large collections — so
   * failures here are logged, not thrown. Callers that want a "fully
   * initialized" guarantee (mainly tests that tear down the workDir right
   * after use) can `await db.ready` instead of racing background I/O.
   */
  readonly ready: Promise<void>;

  constructor(workDir: string) {
    fs.mkdirSync(workDir, { recursive: true });

    this.users = Datastore.create({ filename: path.join(workDir, 'users.db'), autoload: true });
    this.messages = Datastore.create({ filename: path.join(workDir, 'messages.db'), autoload: true });
    this.summaries = Datastore.create({ filename: path.join(workDir, 'summaries.db'), autoload: true });

    this.ready = Promise.all([
      this.messages.ensureIndex({ fieldName: 'userId' }),
      this.messages.ensureIndex({ fieldName: 'createdAt' }),
      this.summaries.ensureIndex({ fieldName: 'userId' }),
    ])
      .then(() => undefined)
      .catch((err) => {
        log.warn({ workDir, err: err instanceof Error ? err.message : String(err) }, 'Index creation failed — continuing without it');
      });

    log.info({ workDir }, 'NeDB datastores ready');
  }

  async upsertUser(telegramId: number, name: string): Promise<StoredUser> {
    const id = String(telegramId);
    const existing = await this.users.findOne({ _id: id });
    const now = new Date().toISOString();

    if (existing) {
      await this.users.update({ _id: id }, { $set: { lastActiveAt: now, name } });
      return { ...existing, lastActiveAt: now, name };
    }

    const user: StoredUser = { _id: id, telegramId, name, createdAt: now, lastActiveAt: now };
    return this.users.insert(user);
  }

  async saveMessage(
    userId: string,
    role: 'user' | 'assistant',
    content: string,
    tokens: number,
    embedding: number[] | null = null,
  ): Promise<StoredMessage> {
    const message: StoredMessage = {
      _id: uuidv4(),
      userId,
      role,
      content,
      embedding,
      tokens,
      createdAt: new Date().toISOString(),
    };
    return this.messages.insert(message);
  }

  async getRecentMessages(userId: string, limit: number): Promise<StoredMessage[]> {
    const docs = await this.messages
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return docs.reverse(); // oldest -> newest for prompt ordering
  }

  async getAllMessagesWithEmbeddings(userId: string): Promise<StoredMessage[]> {
    return this.messages.find({ userId, embedding: { $ne: null } }).exec();
  }

  async countMessagesSince(userId: string, sinceIso: string): Promise<number> {
    return this.messages.count({ userId, createdAt: { $gt: sinceIso } });
  }

  async saveSummary(summary: Omit<StoredSummary, '_id' | 'createdAt'>): Promise<StoredSummary> {
    const doc: StoredSummary = { ...summary, _id: uuidv4(), createdAt: new Date().toISOString() };
    return this.summaries.insert(doc);
  }

  async getAllSummariesWithEmbeddings(userId: string): Promise<StoredSummary[]> {
    return this.summaries.find({ userId, embedding: { $ne: null } }).exec();
  }

  /** Retention sweep — keeps the on-device DB bounded on long-running Termux installs. */
  async pruneOldMessages(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const removed = await this.messages.remove({ createdAt: { $lt: cutoff } }, { multi: true });
    if (removed > 0) log.info({ removed }, 'Pruned old messages');
    return removed;
  }
}
