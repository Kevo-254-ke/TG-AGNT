"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopEmbeddingProvider = void 0;
/**
 * Null-object embedding provider. Lets the rest of the memory pipeline
 * stay written against the EmbeddingProvider interface with no special
 * casing, whether or not vector search is actually enabled.
 */
class NoopEmbeddingProvider {
    name = 'none';
    dimensions = null;
    async embed(_text) {
        return null;
    }
}
exports.NoopEmbeddingProvider = NoopEmbeddingProvider;
//# sourceMappingURL=none.js.map