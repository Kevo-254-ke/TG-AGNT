/**
 * Cheap token estimate (~4 chars/token, adjusted by a word-based
 * multiplier). Good enough for context-budgeting and cost telemetry;
 * not a substitute for a real tokenizer if exact billing accuracy is
 * ever needed.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}
