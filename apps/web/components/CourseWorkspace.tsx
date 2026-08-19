'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, messageFor } from '@/lib/client';

export interface LectureRow {
  id: string;
  title: string;
  occurredOn: string | null;
  status: string;
  segmentCount: number;
  hasRecording: boolean;
}

export interface MaterialRow {
  id: string;
  title: string;
  type: string;
  pageCount: number | null;
  processingStatus: string;
  processingError: string | null;
}

/** Lecture archive + material upload for one course. */
export function CourseWorkspace({
  courseId,
  lectures,
  materials,
}: {
  courseId: string;
  lectures: LectureRow[];
  materials: MaterialRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addLecture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/courses/${courseId}/lectures`, { method: 'POST', json: { title } });
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
          <button type="submit" disabled={busy}>Create lecture</button>
        </form>
      </section>

      <h2>Lecture archive</h2>
      {lectures.length === 0 ? (
        <p className="muted">No lectures yet. Create one, then upload its recording.</p>
      ) : (
        <div className="grid">
          {lectures.map((lecture) => (
            <article key={lecture.id} className="card">
              <h3 style={{ margin: 0 }}>
                <Link href={`/lectures/${lecture.id}`}>{lecture.title}</Link>
              </h3>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                <span className={`pill pill-${lecture.status}`}>{lecture.status}</span>
                {lecture.segmentCount > 0
                  ? ` · transcript ready (${lecture.segmentCount} segments)`
                  : lecture.hasRecording
                    ? ' · recording uploaded'
                    : ' · no recording yet'}
              </p>
            </article>
          ))}
        </div>
      )}

      <section className="card" style={{ marginBlock: '1.5rem' }}>
        <h2>Upload material or recording</h2>
        <p className="muted" style={{ marginBlockStart: 0 }}>
          PDF, text, images, audio, video. Audio attached to a lecture is transcribed automatically.
        </p>
        <form className="stack" onSubmit={upload}>
          <div className="field">
            <label htmlFor="file">File</label>
            <input id="file" name="file" type="file" required />
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
