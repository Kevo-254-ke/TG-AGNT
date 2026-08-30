"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterProvider = void 0;
exports.describeAxiosError = describeAxiosError;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../../config/env");
const logger_1 = require("../../core/logger");
const log = logger_1.logger.child({ module: 'ai:openrouter' });
/**
 * OpenRouter client. OpenRouter proxies many free/cheap models behind one
 * OpenAI-compatible endpoint, so this doubles as a template for adding
 * more OpenAI-compatible providers later — only baseURL/model/env differ.
 */
class OpenRouterProvider {
    apiKey;
    model;
    name = 'openrouter';
    client;
    constructor(apiKey, model) {
        this.apiKey = apiKey;
        this.model = model;
        this.client = axios_1.default.create({
            baseURL: 'https://openrouter.ai/api/v1',
            timeout: env_1.env.AI_TIMEOUT_MS,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://kevoloves.dev',
                'X-Title': 'Telegram Coding Agent',
            },
        });
    }
    get isConfigured() {
        return this.apiKey.length > 0;
    }
    async chat(messages, tools) {
        if (!this.isConfigured) {
            throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY)');
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
                throw new Error('OpenRouter returned no message choice');
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
            log.warn({ err: describeAxiosError(err) }, 'OpenRouter request failed');
            throw err;
        }
    }
}
exports.OpenRouterProvider = OpenRouterProvider;
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
function describeAxiosError(err) {
    if (axios_1.default.isAxiosError(err)) {
        return `${err.response?.status ?? 'no-status'} ${err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message}`;
    }
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=openrouter.js.map