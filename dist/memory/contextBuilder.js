"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextBuilder = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../core/logger");
const tokenCounter_1 = require("../utils/tokenCounter");
const vectorSearch_1 = require("./vectorSearch");
const log = logger_1.logger.child({ module: 'memory:contextBuilder' });
const SYSTEM_PROMPT = 'You are a helpful coding assistant running inside a Telegram bot hosted on Termux (Android/Linux). ' +
    'Each user has their own isolated workspace — files are never shared between users. ' +
    'You can create, read, update, delete, list, zip/unzip files, run short code snippets, read documents, and browse the web via tools. ' +
    'You may call tools across multiple turns in a row — after a tool result comes back, keep going if the task needs more steps. ' +
    'When asked for several files (e.g. separate HTML, CSS, and JS files), create every one of them with its own create_file call, one at a time, before writing your final summary — do not stop after the first file. ' +
    "Any file you create or update is automatically sent to the user as a real file attachment, so don't paste large file contents into your reply — just describe what you did briefly. " +
    'If the user asks for a zip, or you produce multiple related files that belong together, call zip_files to bundle them — only the archive gets sent in that case, not each file separately. Otherwise, when the user asks for files "separately", do not zip them. ' +
    'If you need a document from the user to complete a task, ask them to upload it. When they do, you will receive it automatically in their workspace. ' +
    'Use web_search to find the latest documentation, library versions, or verify current best practices before writing code. Use fetch_webpage to read specific docs in detail. ' +
    'Be concise — replies are read on a phone screen.';
/**
 * Builds the message array sent to the AI provider each turn, trading
 * "send the whole history" for "send what's relevant": a small recent
 * window plus vector-retrieved similar messages/summaries. This is the
 * single biggest lever for keeping a $0 free-tier bot within rate limits.
 */
class ContextBuilder {
    db;
    embeddings;
    skills;
    constructor(db, embeddings, skills) {
        this.db = db;
        this.embeddings = embeddings;
        this.skills = skills;
    }
    async build(userId, userMessage) {
        const queryEmbedding = await this.embeddings.embed(userMessage);
        // Find relevant skills
        const relevantSkills = this.skills ? await this.skills.findRelevant(userMessage) : [];
        const skillsText = this.skills ? this.skills.formatSkills(relevantSkills) : '';
        if (!queryEmbedding) {
            log.debug('No query embedding available — using recency-only context');
            return this.buildBasicContext(userId, userMessage, skillsText);
        }
        const [recent, allMessages, allSummaries] = await Promise.all([
            this.db.getRecentMessages(userId, env_1.env.RECENT_MESSAGES_WINDOW),
            this.db.getAllMessagesWithEmbeddings(userId),
            this.db.getAllSummariesWithEmbeddings(userId),
        ]);
        const recentIds = new Set(recent.map((m) => m._id));
        const searchable = allMessages.filter((m) => !recentIds.has(m._id));
        const similarMessages = (0, vectorSearch_1.topKBySimilarity)(queryEmbedding, searchable, env_1.env.SIMILAR_MESSAGES_LIMIT);
        const similarSummaries = (0, vectorSearch_1.topKBySimilarity)(queryEmbedding, allSummaries, env_1.env.SIMILAR_SUMMARIES_LIMIT);
        const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
        if (skillsText) {
            messages.push({ role: 'system', content: skillsText });
        }
        if (similarSummaries.length > 0) {
            const summaryText = similarSummaries.map((s) => `- ${s.summary}`).join('\n');
            messages.push({ role: 'system', content: `Relevant history:\n${summaryText}` });
        }
        if (similarMessages.length > 0) {
            const relatedText = similarMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
            messages.push({ role: 'system', content: `Related past messages:\n${relatedText}` });
        }
        for (const m of recent) {
            messages.push({ role: m.role, content: m.content });
        }
        messages.push({ role: 'user', content: userMessage });
        const tokenEstimate = messages.reduce((sum, m) => sum + (0, tokenCounter_1.estimateTokens)(m.content), 0);
        return {
            messages,
            tokenEstimate,
            sources: { recent: recent.length, similar: similarMessages.length, summaries: similarSummaries.length },
        };
    }
    /** Fallback when embeddings are unavailable — recency-only, still bounded. */
    async buildBasicContext(userId, userMessage, skillsText) {
        const recent = await this.db.getRecentMessages(userId, env_1.env.RECENT_MESSAGES_WINDOW * 2);
        const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
        if (skillsText) {
            messages.push({ role: 'system', content: skillsText });
        }
        messages.push(...recent.map((m) => ({ role: m.role, content: m.content })));
        messages.push({ role: 'user', content: userMessage });
        const tokenEstimate = messages.reduce((sum, m) => sum + (0, tokenCounter_1.estimateTokens)(m.content), 0);
        return { messages, tokenEstimate, sources: { recent: recent.length, similar: 0, summaries: 0 } };
    }
}
exports.ContextBuilder = ContextBuilder;
//# sourceMappingURL=contextBuilder.js.map