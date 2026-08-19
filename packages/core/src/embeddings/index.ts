import { normalizeForSearch } from '../text';

/**
 * Embeddings (ARCHITECTURE.md §3.9, revised for the one-week MVP).
 *
 * **Model:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, int8-quantized ONNX,
 * run in-process by transformers.js on CPU.
 *
 * | Property        | Value                                        |
 * |-----------------|----------------------------------------------|
 * | Dimensions      | 384                                          |
 * | Languages       | 50+, including Arabic and English            |
 * | Model size      | ~120 MB on disk, cached after first download |
 * | Memory          | ~500 MB RSS with the model resident          |
 * | Load time       | ~3 s, once per process                       |
 * | Latency         | ~7 ms per short text on 4 CPU cores          |
 *
 * **The tradeoff, stated plainly.** BGE-M3 (1024-d, 560M parameters) retrieves
 * better, especially on long Arabic passages. This model is roughly a fifth of
 * the size and an order of magnitude faster on CPU, at some cost in recall on
 * subtle paraphrase. For a demo on a laptop with no GPU, responsiveness and
 * reliability are worth more than the last few points of recall — and the
 * hybrid retriever leans on lexical matching for exact technical terms, which
 * is where small embedding models are weakest anyway.
 *
 * Swapping models later changes nothing but configuration and a backfill: the
 * dimension is stored per row, and no caller knows the model's name.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  isAvailable(): Promise<boolean>;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 384;
const MODEL_ID =
  process.env.EMBEDDING_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; tolist(): number[][] }>;

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly name = MODEL_ID;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private extractor: FeatureExtractor | null = null;
  private loadFailed = false;

  /**
   * Loads once per process and is reused. The first call pays ~3 s; every call
   * after it is milliseconds.
   */
  private async load(): Promise<FeatureExtractor | null> {
    if (this.extractor) return this.extractor;
    if (this.loadFailed) return null;

    try {
      const { pipeline } = await import('@huggingface/transformers');
      const fe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
      this.extractor = fe as unknown as FeatureExtractor;
      return this.extractor;
    } catch (error) {
      // A missing model must not take search down: the hybrid retriever falls
      // back to lexical-only and says so, rather than returning nothing.
      console.warn(`[embeddings] model unavailable, lexical search only: ${String(error)}`);
      this.loadFailed = true;
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async embed(texts: string[], _kind: 'document' | 'query'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    if (!extractor) throw new Error('Embedding model is not available');

    const cleaned = texts.map((text) => text.slice(0, 4000));
    const output = await extractor(cleaned, { pooling: 'mean', normalize: true });
    const flat = output.tolist();

    // transformers.js returns nested arrays already shaped [n][dims].
    return flat.map((row) => (Array.isArray(row) ? (row as unknown as number[]) : []));
  }
}

let cached: EmbeddingProvider | undefined;

export function embeddings(): EmbeddingProvider {
  cached ??= new TransformersEmbeddingProvider();
  return cached;
}

/** Test seam. */
export function setEmbeddingProvider(provider: EmbeddingProvider | undefined): void {
  cached = provider;
}

/**
 * Deterministic provider for tests: same text always yields the same vector,
 * and similar text yields similar vectors, without loading a model.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash-test';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      for (const token of normalizeForSearch(text).split(' ')) {
        if (!token) continue;
        let hash = 0;
        for (let i = 0; i < token.length; i += 1) {
          hash = (hash * 31 + token.charCodeAt(i)) | 0;
        }
        const index = Math.abs(hash) % this.dimensions;
        vector[index] = (vector[index] ?? 0) + 1;
      }
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
      return vector.map((v) => v / magnitude);
    });
  }
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
