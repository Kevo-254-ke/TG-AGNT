import type { EmbeddingProvider } from '../../core/types';

/**
 * Null-object embedding provider. Lets the rest of the memory pipeline
 * stay written against the EmbeddingProvider interface with no special
 * casing, whether or not vector search is actually enabled.
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'none';
  readonly dimensions = null;

  async embed(_text: string): Promise<number[] | null> {
    return null;
  }
}
