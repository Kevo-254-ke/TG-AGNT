"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HuggingFaceEmbeddingProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../../config/env");
const logger_1 = require("../../core/logger");
const log = logger_1.logger.child({ module: 'embeddings:huggingface' });
/**
 * Free-tier Hugging Face feature-extraction endpoint. Works without an API
 * key (rate-limited), or with one (HUGGINGFACE_API_KEY) for higher limits.
 * On any failure this resolves `null` rather than throwing — embeddings
 * are an optimization, not a hard dependency, so the rest of the memory
 * pipeline degrades gracefully (see ContextBuilder's basic-context fallback).
 */
class HuggingFaceEmbeddingProvider {
    apiKey;
    name = 'huggingface';
    dimensions = 384; // all-MiniLM-L6-v2
    url;
    constructor(apiKey, model = env_1.env.HUGGINGFACE_MODEL) {
        this.apiKey = apiKey;
        this.url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;
    }
    async embed(text) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey)
                headers.Authorization = `Bearer ${this.apiKey}`;
            const { data } = await axios_1.default.post(this.url, { inputs: text, options: { wait_for_model: true } }, { timeout: 10_000, headers });
            const vector = flattenToVector(data);
            if (!vector) {
                log.warn('Unexpected embedding response shape');
                return null;
            }
            return vector;
        }
        catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embedding request failed');
            return null;
        }
    }
}
exports.HuggingFaceEmbeddingProvider = HuggingFaceEmbeddingProvider;
/** HF's feature-extraction endpoint returns nested arrays (token-level); mean-pool to one vector. */
function flattenToVector(data) {
    if (!Array.isArray(data))
        return null;
    if (typeof data[0] === 'number')
        return data;
    if (Array.isArray(data[0])) {
        const tokens = data;
        if (Array.isArray(tokens[0]?.[0])) {
            // batch of sequences [ [ [floats...], ... ] ] — take first sequence
            return meanPool(tokens[0]);
        }
        return meanPool(tokens);
    }
    return null;
}
function meanPool(tokenVectors) {
    if (tokenVectors.length === 0)
        return null;
    const dim = tokenVectors[0].length;
    const sums = new Array(dim).fill(0);
    for (const vec of tokenVectors) {
        for (let i = 0; i < dim; i++)
            sums[i] += vec[i] ?? 0;
    }
    return sums.map((s) => s / tokenVectors.length);
}
//# sourceMappingURL=huggingface.js.map