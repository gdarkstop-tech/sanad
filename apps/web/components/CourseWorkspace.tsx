'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/client';
import { TranscriptSourceNote, type TranscriptionSource } from '@/components/TranscriptSourceNote';

export interface LectureRow {
  id: string;
  title: string;
  occurredOn: string | null;
  status: string;
  segmentCount: number;
  hasRecording: boolean;
  folder: string | null;
  transcription: TranscriptionSource | null;
}

export interface MaterialRow {
  id: string;
  title: string;
  type: string;
  pageCount: number | null;
  processingStatus: string;
  processingError: string | null;
  folder: string | null;
}

/** Lecture archive + material upload for one course. */
export function CourseWorkspace({
  courseId,
  lectures,
  materials,
  realTranscription,
}: {
  courseId: string;
  lectures: LectureRow[];
  materials: MaterialRow[];
  /** False when no speech-recognition engine is installed on the server. */
  realTranscription: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transcription and extraction finish after the upload response returns, so
  // without this the student watches a "processing" pill that never changes and
  // has to work out for themselves that a reload is what they need. Polling
  // stops as soon as everything settles, and gives up rather than running
  // forever if a job is genuinely stuck.
  const settling =
    materials.some((m) => m.processingStatus !== 'ready' && m.processingStatus !== 'failed') ||
    lectures.some((l) => l.status === 'processing' || l.status === 'recording');
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    if (!settling || checks >= 20) return;
    const timer = setTimeout(() => {
      setChecks((count) => count + 1);
      router.refresh();
    }, 3000);
    return () => clearTimeout(timer);
  }, [settling, checks, router]);

  useEffect(() => {
    if (!settling) setChecks(0);
  }, [settling]);

  /**
   * Folders are a heading in a list, not a filesystem — so grouping happens
   * here rather than in a tree component. Named folders sort alphabetically and
   * ungrouped lectures fall to the bottom, where a student expects them.
   */
  const folderNames = [
    ...new Set(
      [...lectures.map((l) => l.folder), ...materials.map((m) => m.folder)].filter(
        (name): name is string => Boolean(name),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const groupedLectures = [
    ...folderNames
      .map((name) => ({ name, items: lectures.filter((l) => l.folder === name) }))
      .filter((group) => group.items.length > 0),
    { name: null as string | null, items: lectures.filter((l) => !l.folder) },
  ].filter((group) => group.items.length > 0);

  async function addLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) return;
    const folder = String(data.get('folder') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/lectures`, {
        method: 'POST',
        json: { title, folder: folder || null },
      });
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!(data.get('file') instanceof File)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/materials`, { method: 'POST', body: data });
      form.reset();
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <p className="error" role="alert">{error}</p> : null}

      <section className="card" style={{ marginBlockEnd: '1.5rem' }}>
        <h2>Add a lecture</h2>
        <form className="stack" onSubmit={addLecture}>
          <div className="field">
            <label htmlFor="lecture-title">Lecture title</label>
            <input id="lecture-title" name="title" required maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="lecture-folder">Folder (optional)</label>
            <input
              id="lecture-folder"
              name="folder"
              maxLength={80}
              list="known-folders"
              placeholder="Week 3, Revision, Midterm…"
            />
            <datalist id="known-folders">
              {folderNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create lecture'}</button>
        </form>
      </section>

      {settling ? (
        <p className="muted" role="status">
          {checks >= 20
            ? 'Something is still processing. Reload to check again.'
            : 'Processing in the background — this page updates itself.'}
        </p>
      ) : null}

      <h2>Lecture archive</h2>
      {lectures.length === 0 ? (
        <p className="muted">No lectures yet. Create one, then upload its recording.</p>
      ) : (
        groupedLectures.map((group) => (
          <div key={group.name ?? '__ungrouped'}>
            {group.name ? (
              <h3 className="folder-heading">
                {group.name} <span className="muted">· {group.items.length}</span>
              </h3>
            ) : groupedLectures.length > 1 ? (
              <h3 className="folder-heading muted">Not in a folder</h3>
            ) : null}
            <div className="grid">
              {group.items.map((lecture) => (
                <article key={lecture.id} className="card">
                  <h3 style={{ margin: 0 }}>
                    <Link href={`/lectures/${lecture.id}`}>{lecture.title}</Link>
                  </h3>
                  <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                    <span className={`pill pill-${lecture.status}`}>{lecture.status}</span>{' '}
                    <TranscriptSourceNote source={lecture.transcription} compact />
                    {lecture.segmentCount > 0
                      ? ` · transcript ready (${lecture.segmentCount} segments)`
                      : lecture.hasRecording
                        ? ' · recording uploaded'
                        : ' · no recording yet'}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ))
      )}

      <section className="card" style={{ marginBlock: '1.5rem' }}>
        <h2>Upload material or recording</h2>
        <p className="muted" style={{ marginBlockStart: 0 }}>
          PDF, text, DOCX, PPTX, images, audio, video.{' '}
          {realTranscription
            ? 'Audio attached to a lecture is transcribed automatically.'
            : null}
        </p>
        {realTranscription ? null : (
          <p className="synthetic-note">
            <strong>No speech-recognition engine is installed on this server.</strong> Audio
            you attach to a lecture will be stored untouched, but Sanad will fill the
            transcript with placeholder sentences rather than transcribing it. Documents are
            unaffected — PDF, DOCX, PPTX and text are read for real.
          </p>
        )}
        <form className="stack" onSubmit={upload}>
          <div className="field">
            <label htmlFor="file">File</label>
            <input id="file" name="file" type="file" required />
          </div>
          <div className="field">
            <label htmlFor="material-folder">Folder (optional)</label>
            <input
              id="material-folder"
              name="folder"
              maxLength={80}
              list="known-folders"
              placeholder="Week 3, Revision…"
            />
          </div>
          <div className="field">
            <label htmlFor="lectureId">Attach to lecture (optional)</label>
            <select id="lectureId" name="lectureId" defaultValue="">
              <option value="">Course-level material</option>
              {lectures.map((lecture) => (
                <option key={lecture.id} value={lecture.id}>{lecture.title}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        </form>
      </section>

      <h2>Materials</h2>
      {materials.length === 0 ? (
        <p className="muted">Nothing uploaded yet.</p>
      ) : (
        <ul className="plain">
          {materials.map((material) => (
            <li key={material.id} className="card" style={{ marginBlockEnd: '0.6rem' }}>
              <strong>{material.title}</strong>
              <span className="muted">
                {' '}· {material.type}
                {material.pageCount ? ` · ${material.pageCount} pages` : ''}
                {material.folder ? ` · ${material.folder}` : ''}
              </span>
              <div>
                <span className={`pill pill-${material.processingStatus}`}>
                  {material.processingStatus}
                </span>
                {material.processingError ? (
                  <span className="error" style={{ display: 'block', marginBlockStart: '0.4rem' }}>
                    {material.processingError}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
