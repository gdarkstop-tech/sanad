import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Speech recognition behind one interface (AI_PIPELINE.md §1).
 *
 * Budget is $0 and there is no GPU, so the real implementation is an
 * open-source engine on CPU. The fixture implementation exists so the rest of
 * the pipeline — segments, anchors, chunking, retrieval, citations — is
 * complete and testable before real audio or a compiled engine exists.
 *
 * Fixture output is never a benchmark result. `ASR_BENCHMARK.md` governs that,
 * and every provider records its name on the session so a stored transcript
 * always says what produced it.
 */

export interface AsrSegment {
  seq: number;
  tStartMs: number;
  tEndMs: number;
  text: string;
  /** 0..1, normalized across providers. Null when a provider reports none. */
  confidence: number | null;
  language: string | null;
  isCodeSwitched: boolean;
}

export interface AsrResult {
  provider: string;
  model: string;
  segments: AsrSegment[];
  durationMs: number;
  /** Wall-clock processing time, for the real-time factor. */
  processingMs: number;
}

export interface AsrOptions {
  /** BCP-47 hints, e.g. ['ar', 'en']. Never a fixed pair in code. */
  languageHints?: string[];
  /** Canonical vocabulary terms used to bias recognition. */
  vocabulary?: string[];
}

export interface AsrProvider {
  readonly name: string;
  readonly model: string;
  /** True when this provider can actually run here. */
  isAvailable(): Promise<boolean>;
  transcribeFile(filePath: string, options?: AsrOptions): Promise<AsrResult>;
}

/** Script detection, shared by every provider so the field means one thing. */
export function detectSegmentLanguage(text: string): {
  language: string | null;
  isCodeSwitched: boolean;
} {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return { language: null, isCodeSwitched: false };
  if (arabic > 0 && latin > 0) {
    const ratio = arabic / (arabic + latin);
    if (ratio > 0.85) return { language: 'ar', isCodeSwitched: false };
    if (ratio < 0.15) return { language: 'en', isCodeSwitched: false };
    // Genuine mid-sentence switching: preserved, never normalized to one
    // language, because that is how the material is actually taught.
    return { language: 'mixed', isCodeSwitched: true };
  }
  return { language: arabic > 0 ? 'ar' : 'en', isCodeSwitched: false };
}

export function bandFor(confidence: number | null): 'high' | 'medium' | 'low' | null {
  if (confidence === null) return null;
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/**
 * Deterministic fixture provider.
 *
 * Resolution order:
 *   1. a sidecar `<audio>.transcript.json` beside the audio file
 *   2. `SANAD_ASR_FIXTURE_DIR/<sha256-prefix>.json`
 *   3. a synthesized transcript derived from the file's own bytes
 *
 * (3) exists so an arbitrary upload still produces a well-formed transcript
 * with timestamps and confidence — enough to exercise chunking, search and
 * citations — without inventing subject matter.
 */
export class FixtureAsrProvider implements AsrProvider {
  readonly name = 'fixture';
  readonly model = 'fixture-v1';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribeFile(filePath: string, options: AsrOptions = {}): Promise<AsrResult> {
    const started = Date.now();
    const data = await fs.readFile(filePath).catch(() => Buffer.alloc(0));

    const fromSidecar = await this.loadSidecar(filePath);
    const fromDirectory = fromSidecar ? null : await this.loadFromFixtureDir(data);
    const raw = fromSidecar ?? fromDirectory ?? this.synthesize(data, options);

    const segments = raw.map((segment, index) => {
      const detected = detectSegmentLanguage(segment.text);
      return {
        seq: index,
        tStartMs: segment.tStartMs,
        tEndMs: segment.tEndMs,
        text: segment.text,
        confidence: segment.confidence ?? null,
        language: detected.language,
        isCodeSwitched: detected.isCodeSwitched,
      } satisfies AsrSegment;
    });

    const durationMs = segments.length > 0 ? (segments[segments.length - 1]?.tEndMs ?? 0) : 0;
    return {
      provider: this.name,
      model: this.model,
      segments,
      durationMs,
      processingMs: Date.now() - started,
    };
  }

  private async loadSidecar(filePath: string): Promise<RawSegment[] | null> {
    const candidate = `${filePath}.transcript.json`;
    try {
      return parseRaw(JSON.parse(await fs.readFile(candidate, 'utf8')));
    } catch {
      return null;
    }
  }

  private async loadFromFixtureDir(data: Buffer): Promise<RawSegment[] | null> {
    const dir = process.env.SANAD_ASR_FIXTURE_DIR;
    if (!dir) return null;
    const digest = createHash('sha256').update(data).digest('hex').slice(0, 16);
    try {
      const file = path.join(dir, `${digest}.json`);
      return parseRaw(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch {
      return null;
    }
  }

  /**
   * Synthesizes a transcript deterministically from the audio bytes.
   *
   * The phrases are structural — connective language a lecture in any subject
   * contains — with no subject matter, because the product must never assume
   * one. Mixed-script lines exercise the code-switching path.
   */
  private synthesize(data: Buffer, options: AsrOptions): RawSegment[] {
    const seed = createHash('sha256').update(data).digest();
    const hints = options.languageHints ?? ['ar', 'en'];
    const vocabulary = options.vocabulary ?? [];

    const templates: string[] = [];
    if (hints.includes('en')) {
      templates.push(
        'Let us continue from where we stopped last time',
        'This part is worth writing down carefully',
        'Notice how the two cases differ here',
      );
    }
    if (hints.includes('ar')) {
      templates.push(
        'نكمل من النقطة اللي وقفنا عندها',
        'دي نقطة مهمة جدا ركزوا معايا',
        'خلينا نشوف المثال ده بالتفصيل',
      );
    }
    if (hints.includes('ar') && hints.includes('en')) {
      // The code-switching case, which is the pipeline's hard path.
      const term = vocabulary[0] ?? 'the definition';
      templates.push(`الـ ${term} ده مهم في الامتحان`);
    }
    if (templates.length === 0) templates.push('Continuing with the material');

    // Cycle rather than sample: a fixture that sometimes omits the Arabic or
    // code-switched cases is a fixture that sometimes fails to exercise the
    // hard path. Every template appears, in a stable order.
    const count = Math.max(templates.length, 6 + (seed[0]! % 5));
    const segments: RawSegment[] = [];
    let cursor = 0;

    for (let i = 0; i < count; i += 1) {
      const template = templates[i % templates.length]!;
      const durationMs = 3000 + (seed[(i + 3) % seed.length]! % 4000);
      // Confidence spread includes low values so the uncertainty path is exercised.
      const confidence = 0.55 + (seed[(i + 7) % seed.length]! % 45) / 100;
      segments.push({
        tStartMs: cursor,
        tEndMs: cursor + durationMs,
        text: template,
        confidence: Number(confidence.toFixed(2)),
      });
      cursor += durationMs + 200;
    }

    return segments;
  }
}

interface RawSegment {
  tStartMs: number;
  tEndMs: number;
  text: string;
  confidence?: number | null;
}

function parseRaw(input: unknown): RawSegment[] {
  const list = Array.isArray(input) ? input : (input as { segments?: unknown[] })?.segments;
  if (!Array.isArray(list)) throw new Error('Fixture transcript must be an array of segments');
  return list.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      tStartMs: Number(record.tStartMs ?? record.start_ms ?? 0),
      tEndMs: Number(record.tEndMs ?? record.end_ms ?? 0),
      text: String(record.text ?? ''),
      confidence:
        record.confidence === undefined || record.confidence === null
          ? null
          : Number(record.confidence),
    };
  });
}

/**
 * whisper.cpp adapter.
 *
 * Free, open-source, CPU-only, spawned as a binary — which is why the AI tier
 * did not need to be Python. Availability is detected rather than assumed, so a
 * machine without it degrades to the fixture instead of failing an upload.
 */
export class WhisperCppProvider implements AsrProvider {
  readonly name = 'whisper.cpp';

  constructor(
    readonly model: string = process.env.WHISPER_MODEL ?? 'base',
    private readonly binary: string = process.env.WHISPER_BIN ?? 'whisper-cli',
    private readonly modelPath: string = process.env.WHISPER_MODEL_PATH ?? '',
  ) {}

  async isAvailable(): Promise<boolean> {
    if (!this.modelPath) return false;
    try {
      await fs.access(this.modelPath);
    } catch {
      return false;
    }
    return new Promise((resolve) => {
      const probe = spawn(this.binary, ['--help'], { stdio: 'ignore' });
      probe.on('error', () => resolve(false));
      probe.on('close', (code) => resolve(code === 0 || code === 1));
    });
  }

  async transcribeFile(filePath: string, options: AsrOptions = {}): Promise<AsrResult> {
    const started = Date.now();
    const outputPrefix = `${filePath}.whisper`;

    const args = [
      '-m', this.modelPath,
      '-f', filePath,
      '-oj',                          // JSON output
      '-of', outputPrefix,
      '-l', options.languageHints?.[0] ?? 'auto',
      // Pinned explicitly: whisper-family models otherwise sometimes translate
      // at a language switch, which is fluent and wrong about what was said.
      '-tr', 'false',
    ];
    if (options.vocabulary?.length) {
      args.push('--prompt', options.vocabulary.slice(0, 200).join(', '));
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`whisper.cpp exited with ${code}`)),
      );
    });

    const parsed = JSON.parse(await fs.readFile(`${outputPrefix}.json`, 'utf8')) as {
      transcription?: Array<{
        offsets?: { from: number; to: number };
        text?: string;
      }>;
    };
    await fs.rm(`${outputPrefix}.json`, { force: true });

    const segments: AsrSegment[] = (parsed.transcription ?? []).map((item, index) => {
      const text = (item.text ?? '').trim();
      const detected = detectSegmentLanguage(text);
      return {
        seq: index,
        tStartMs: item.offsets?.from ?? 0,
        tEndMs: item.offsets?.to ?? 0,
        text,
        // whisper.cpp JSON does not expose a per-segment probability by
        // default; recording null is honest, and the UI shows no band rather
        // than a fabricated one.
        confidence: null,
        language: detected.language,
        isCodeSwitched: detected.isCodeSwitched,
      };
    });

    return {
      provider: this.name,
      model: this.model,
      segments: segments.filter((s) => s.text.length > 0),
      durationMs: segments.at(-1)?.tEndMs ?? 0,
      processingMs: Date.now() - started,
    };
  }
}

let cachedProvider: AsrProvider | undefined;

/**
 * Picks the best provider that can actually run here.
 *
 * whisper.cpp when installed and configured, otherwise the fixture — so the
 * product works on a fresh laptop, and the transcript always records which one
 * produced it.
 */
export async function resolveAsrProvider(): Promise<AsrProvider> {
  if (cachedProvider) return cachedProvider;

  const whisper = new WhisperCppProvider();
  cachedProvider = (await whisper.isAvailable()) ? whisper : new FixtureAsrProvider();
  return cachedProvider;
}

/** Test seam. */
export function setAsrProvider(provider: AsrProvider | undefined): void {
  cachedProvider = provider;
}
