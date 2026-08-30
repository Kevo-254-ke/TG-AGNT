"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIFallbackRouter = void 0;
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'ai:fallbackRouter' });
const BREAKER_COOLDOWN_MS = 60_000;
const BREAKER_FAILURE_THRESHOLD = 3;
/**
 * Routes a chat request through providers in priority order.
 *
 * Each provider gets a tiny circuit breaker: after N consecutive failures
 * it's skipped for a cooldown window instead of being retried on every
 * message (avoids hammering a provider that's clearly down and wasting
 * the request timeout budget). If every provider is unavailable, we fall
 * back to a degraded, tool-only mode rather than erroring out entirely —
 * a coding agent that can still create/read files is more useful than one
 * that goes fully silent when the AI API is down.
 */
class AIFallbackRouter {
    providers;
    breakers = new Map();
    constructor(providers) {
        this.providers = providers;
        if (providers.length === 0) {
            log.warn('AIFallbackRouter constructed with zero providers — will always run in degraded mode');
        }
    }
    async chat(messages, tools) {
        const errors = [];
        for (const provider of this.providers) {
            if (this.isOpen(provider.name)) {
                log.debug({ provider: provider.name }, 'Skipping provider — circuit open');
                continue;
            }
            try {
                const response = await provider.chat(messages, tools);
                this.recordSuccess(provider.name);
                return response;
            }
            catch (err) {
                this.recordFailure(provider.name);
                const reason = err instanceof Error ? err.message : String(err);
                errors.push(`${provider.name}: ${reason}`);
                log.warn({ provider: provider.name, reason }, 'Provider failed, trying next');
            }
        }
        log.error({ errors }, 'All AI providers unavailable — falling back to degraded mode');
        return this.degradedResponse(messages, errors);
    }
    /** True circuit-breaker "is it currently blocked" check. */
    isOpen(providerName) {
        const state = this.breakers.get(providerName);
        if (!state)
            return false;
        if (state.openUntil === 0)
            return false;
        if (Date.now() >= state.openUntil) {
            // Cooldown elapsed — allow a fresh attempt (half-open).
            state.openUntil = 0;
            state.consecutiveFailures = 0;
            return false;
        }
        return true;
    }
    recordSuccess(providerName) {
        this.breakers.set(providerName, { consecutiveFailures: 0, openUntil: 0 });
    }
    recordFailure(providerName) {
        const state = this.breakers.get(providerName) ?? { consecutiveFailures: 0, openUntil: 0 };
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
            state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
            log.warn({ provider: providerName, cooldownMs: BREAKER_COOLDOWN_MS }, 'Circuit opened for provider');
        }
        this.breakers.set(providerName, state);
    }
    /**
     * No AI provider reachable. Still give the user something useful:
     * acknowledge the message and tell them which tools remain available,
     * rather than throwing and leaving the bot silent.
     */
    degradedResponse(messages, errors) {
        const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        const mentionsFiles = /file|zip|create|read|list/i.test(lastUserMessage);
        const content = mentionsFiles
            ? "I can't reach any AI model right now, but I can still run file operations directly — try a specific command like /files or /read <name>."
            : "I can't reach any AI model right now (all providers are down or unconfigured). File tools still work — everything else will resume once a provider recovers.";
        return {
            content,
            toolCalls: [],
            provider: 'degraded',
            model: 'none',
            raw: { errors },
        };
    }
    /** Exposed for a /status command — surfaces breaker health without leaking internals. */
    getHealth() {
        const health = {};
        for (const provider of this.providers) {
            health[provider.name] = { available: !this.isOpen(provider.name) };
        }
        return health;
    }
}
exports.AIFallbackRouter = AIFallbackRouter;
//# sourceMappingURL=fallbackRouter.js.map