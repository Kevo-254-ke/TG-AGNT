"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cosineSimilarity = cosineSimilarity;
exports.topKBySimilarity = topKBySimilarity;
/** Pure-JS cosine similarity — no native deps, trivial to unit test. */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length)
        return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0)
        return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
/**
 * Ranks candidates by similarity to a query embedding and returns the
 * top `limit`. Generic over any embeddable record so it works for both
 * StoredMessage and StoredSummary without duplication.
 */
function topKBySimilarity(queryEmbedding, candidates, limit) {
    return candidates
        .map((item) => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
        .filter((scored) => scored.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((scored) => scored.item);
}
//# sourceMappingURL=vectorSearch.js.map