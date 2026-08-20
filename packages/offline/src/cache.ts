import type { HttpClient, NetworkAdapter, QueueStorage } from './types';

/**
 * Offline content cache (Priority 3).
 *
 * Downloaded transcripts, summaries, flashcards and course metadata are
 * readable with no network. AI *generation* still needs connectivity, and this
 * says so rather than pretending otherwise — there is no offline model.
 */

export const CACHE_PREFIX = 'sanad.cache.';

export interface CachedCourse {
  courseId: string;
  title: string;
  cachedAt: number;
  lectures: Array<{
    id: string;
    title: string;
    status: string;
    segments: Array<{
      tStartMs: number;
      text: string;
      language: string | null;
      confidenceBand: string | null;
    }>;
    emphasis: Array<{ tStartMs: number; quote: string; importanceType: string }>;
  }>;
  materials: Array<{ id: string; title: string; type: string; pageCount: number | null }>;
  summary: string | null;
  flashcards: Array<{ id: string; front: string; back: string }>;
}

export class ContentCache {
  constructor(
    private readonly storage: QueueStorage,
    private readonly http: HttpClient,
    private readonly network: NetworkAdapter,
  ) {}

  private key(courseId: string): string {
    return CACHE_PREFIX + courseId;
  }

  async read(courseId: string): Promise<CachedCourse | null> {
    const raw = await this.storage.get(this.key(courseId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedCourse;
    } catch {
      await this.storage.remove(this.key(courseId));
      return null;
    }
  }

  async list(): Promise<CachedCourse[]> {
    const keys = (await this.storage.keys()).filter((key) => key.startsWith(CACHE_PREFIX));
    const courses: CachedCourse[] = [];
    for (const key of keys) {
      const raw = await this.storage.get(key);
      if (!raw) continue;
      try {
        courses.push(JSON.parse(raw) as CachedCourse);
      } catch {
        await this.storage.remove(key);
      }
    }
    return courses.sort((a, b) => b.cachedAt - a.cachedAt);
  }

  async remove(courseId: string): Promise<void> {
    await this.storage.remove(this.key(courseId));
  }

  /**
   * Downloads a course for offline use.
   *
   * Written last, in one operation: a half-written cache entry is worse than
   * none, because it looks available and then isn't.
   */
  async download(courseId: string, courseTitle: string): Promise<CachedCourse> {
    if (!(await this.network.isOnline())) {
      throw new Error('You need a connection to download this course.');
    }

    const lectureList = await this.http.getJson(`/api/v1/courses/${courseId}/lectures`);
    if (!lectureList.ok) throw new Error('Could not load the lecture list.');
    const lectures = (lectureList.body as { lectures?: Array<{ id: string; title: string; status: string }> })
      .lectures ?? [];

    const detailed: CachedCourse['lectures'] = [];
    for (const lecture of lectures) {
      const response = await this.http.getJson(`/api/v1/lectures/${lecture.id}/transcript`);
      if (!response.ok) continue;
      const body = response.body as {
        segments?: CachedCourse['lectures'][number]['segments'];
        emphasis?: CachedCourse['lectures'][number]['emphasis'];
      };
      detailed.push({
        id: lecture.id,
        title: lecture.title,
        status: lecture.status,
        segments: body.segments ?? [],
        emphasis: body.emphasis ?? [],
      });
    }

    const materialList = await this.http.getJson(`/api/v1/courses/${courseId}/materials`);
    const materials =
      (materialList.body as { materials?: CachedCourse['materials'] }).materials ?? [];

    // Exam Mode also yields the course summary and flashcards, which is what
    // makes them readable offline. Failing here is not fatal: the transcripts
    // are the part a student most needs without a network.
    let summary: string | null = null;
    let flashcards: CachedCourse['flashcards'] = [];
    const exam = await this.http.postJson(`/api/v1/courses/${courseId}/exam`, {
      questionCount: 10,
    });
    if (exam.ok) {
      const pack = (exam.body as {
        exam?: { summary: string | null; flashcards: CachedCourse['flashcards'] };
      }).exam;
      summary = pack?.summary ?? null;
      flashcards = pack?.flashcards ?? [];
    }

    const cached: CachedCourse = {
      courseId,
      title: courseTitle,
      cachedAt: Date.now(),
      lectures: detailed,
      materials,
      summary,
      flashcards,
    };

    await this.storage.set(this.key(courseId), JSON.stringify(cached));
    return cached;
  }

  /** Bytes held per course, so a student can see what to free. */
  async sizeOf(courseId: string): Promise<number> {
    const raw = await this.storage.get(this.key(courseId));
    return raw ? raw.length : 0;
  }
}
