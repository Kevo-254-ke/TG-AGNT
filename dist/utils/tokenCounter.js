"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = estimateTokens;
/**
 * Cheap token estimate (~4 chars/token, adjusted by a word-based
 * multiplier). Good enough for context-budgeting and cost telemetry;
 * not a substitute for a real tokenizer if exact billing accuracy is
 * ever needed.
 */
function estimateTokens(text) {
    if (!text)
        return 0;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words * 1.3));
}
//# sourceMappingURL=tokenCounter.js.map