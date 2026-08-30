"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroqProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../../config/env");
const logger_1 = require("../../core/logger");
const openrouter_1 = require("./openrouter");
const log = logger_1.logger.child({ module: 'ai:groq' });
/** Groq client — fast inference, generous free tier, used as the fallback. */
class GroqProvider {
    apiKey;
    model;
    name = 'groq';
    client;
    constructor(apiKey, model) {
        this.apiKey = apiKey;
        this.model = model;
        this.client = axios_1.default.create({
            baseURL: 'https://api.groq.com/openai/v1',
            timeout: env_1.env.AI_TIMEOUT_MS,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });
    }
    get isConfigured() {
        return this.apiKey.length > 0;
    }
    async chat(messages, tools) {
        if (!this.isConfigured) {
            throw new Error('Groq is not configured (missing GROQ_API_KEY)');
        }
        const payload = {
            model: this.model,
            messages,
            temperature: env_1.env.AI_TEMPERATURE,
            max_tokens: env_1.env.AI_MAX_TOKENS,
        };
        if (tools?.length) {
            payload.tools = tools;
            payload.tool_choice = 'auto';
        }
        try {
            const { data } = await this.client.post('/chat/completions', payload);
            const choice = data?.choices?.[0]?.message;
            if (!choice)
                throw new Error('Groq returned no message choice');
            const toolCalls = (choice.tool_calls ?? []).map((tc) => ({
                id: tc.id,
                name: tc.function?.name,
                arguments: safeJsonParse(tc.function?.arguments),
            }));
            return {
                content: choice.content ?? '',
                toolCalls,
                provider: this.name,
                model: this.model,
                raw: data,
            };
        }
        catch (err) {
            log.warn({ err: (0, openrouter_1.describeAxiosError)(err) }, 'Groq request failed');
            throw err;
        }
    }
}
exports.GroqProvider = GroqProvider;
function safeJsonParse(input) {
    if (typeof input !== 'string')
        return {};
    try {
        return JSON.parse(input);
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=groq.js.map