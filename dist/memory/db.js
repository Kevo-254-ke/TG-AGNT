"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryDatabase = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const nedb_promises_1 = __importDefault(require("nedb-promises"));
const uuid_1 = require("uuid");
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'memory:db' });
/**
 * Pure-JS embedded database (NeDB) — no native builds, works out of the
 * box in Termux. Swappable later: everything in this class talks in
 * domain types (StoredUser/StoredMessage/StoredSummary), so migrating to
 * Postgres/SQLite down the line only means rewriting this one file.
 */
class MemoryDatabase {
    users;
    messages;
    summaries;
    /**
     * Resolves once index creation has settled (success or failure). Index
     * creation is a performance optimization, not a correctness requirement
     * — reads/writes work without it, just slower on large collections — so
     * failures here are logged, not thrown. Callers that want a "fully
     * initialized" guarantee (mainly tests that tear down the workDir right
     * after use) can `await db.ready` instead of racing background I/O.
     */
    ready;
    constructor(workDir) {
        node_fs_1.default.mkdirSync(workDir, { recursive: true });
        this.users = nedb_promises_1.default.create({ filename: node_path_1.default.join(workDir, 'users.db'), autoload: true });
        this.messages = nedb_promises_1.default.create({ filename: node_path_1.default.join(workDir, 'messages.db'), autoload: true });
        this.summaries = nedb_promises_1.default.create({ filename: node_path_1.default.join(workDir, 'summaries.db'), autoload: true });
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
    async upsertUser(telegramId, name) {
        const id = String(telegramId);
        const existing = await this.users.findOne({ _id: id });
        const now = new Date().toISOString();
        if (existing) {
            await this.users.update({ _id: id }, { $set: { lastActiveAt: now, name } });
            return { ...existing, lastActiveAt: now, name };
        }
        const user = { _id: id, telegramId, name, createdAt: now, lastActiveAt: now };
        return this.users.insert(user);
    }
    async saveMessage(userId, role, content, tokens, embedding = null) {
        const message = {
            _id: (0, uuid_1.v4)(),
            userId,
            role,
            content,
            embedding,
            tokens,
            createdAt: new Date().toISOString(),
        };
        return this.messages.insert(message);
    }
    async getRecentMessages(userId, limit) {
        const docs = await this.messages
            .find({ userId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .exec();
        return docs.reverse(); // oldest -> newest for prompt ordering
    }
    async getAllMessagesWithEmbeddings(userId) {
        return this.messages.find({ userId, embedding: { $ne: null } }).exec();
    }
    async countMessagesSince(userId, sinceIso) {
        return this.messages.count({ userId, createdAt: { $gt: sinceIso } });
    }
    async saveSummary(summary) {
        const doc = { ...summary, _id: (0, uuid_1.v4)(), createdAt: new Date().toISOString() };
        return this.summaries.insert(doc);
    }
    async getAllSummariesWithEmbeddings(userId) {
        return this.summaries.find({ userId, embedding: { $ne: null } }).exec();
    }
    /** Retention sweep — keeps the on-device DB bounded on long-running Termux installs. */
    async pruneOldMessages(olderThanDays) {
        const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
        const removed = await this.messages.remove({ createdAt: { $lt: cutoff } }, { multi: true });
        if (removed > 0)
            log.info({ removed }, 'Pruned old messages');
        return removed;
    }
}
exports.MemoryDatabase = MemoryDatabase;
//# sourceMappingURL=db.js.map