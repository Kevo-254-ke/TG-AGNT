import axios from 'axios';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { EmbeddingProvider } from '../../core/types';

const log = logger.child({ module: 'embeddings:huggingface' });

/**
 * Free-tier Hugging Face feature-extraction endpoint. Works without an API
 * key (rate-limited), or with one (HUGGINGFACE_API_KEY) for higher limits.
 * On any failure this resolves `null` rather than throwing — embeddings
 * are an optimization, not a hard dependency, so the rest of the memory
 * pipeline degrades gracefully (see ContextBuilder's basic-context fallback).
 */
export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'huggingface';
  readonly dimensions = 384; // all-MiniLM-L6-v2

  private readonly url: string;

  constructor(private readonly apiKey: string, model: string = env.HUGGINGFACE_MODEL) {
    this.url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const { data } = await axios.post(
        this.url,
        { inputs: text, options: { wait_for_model: true } },
        { timeout: 10_000, headers },
      );

      const vector = flattenToVector(data);
      if (!vector) {
        log.warn('Unexpected embedding response shape');
        return null;
      }
      return vector;
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embedding request failed');
      return null;
    }
  }
}

/** HF's feature-extraction endpoint returns nested arrays (token-level); mean-pool to one vector. */
function flattenToVector(data: unknown): number[] | null {
  if (!Array.isArray(data)) return null;
  if (typeof data[0] === 'number') return data as number[];

  if (Array.isArray(data[0])) {
    const tokens = data as number[][];
    if (Array.isArray(tokens[0]?.[0])) {
      // batch of sequences [ [ [floats...], ... ] ] — take first sequence
      return meanPool((tokens[0] as unknown) as number[][]);
    }
    return meanPool(tokens);
  }
  return null;
}

function meanPool(tokenVectors: number[][]): number[] | null {
  if (tokenVectors.length === 0) return null;
  const dim = tokenVectors[0].length;
  const sums = new Array(dim).fill(0);
  for (const vec of tokenVectors) {
    for (let i = 0; i < dim; i++) sums[i] += vec[i] ?? 0;
  }
  return sums.map((s) => s / tokenVectors.length);
}
