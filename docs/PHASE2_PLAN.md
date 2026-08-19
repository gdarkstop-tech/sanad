# Phase 2 plan — lectures and materials

**Status:** planned, not started. Phase 1 is complete; Phase 1b (auth hardening)
is scheduled ahead of this.

Phase 2 builds the content layer everything downstream reads from: lectures,
object storage, resumable upload, extraction, and the job queue. It stops short
of transcription, which belongs to Phase 3 and depends on the benchmark.

## Why this can start before the benchmark finishes

The benchmark decides **which ASR engine** and **whether a live tier exists**
([ASR_BENCHMARK.md](../ASR_BENCHMARK.md) §7). Neither answer changes anything in
Phase 2:

- Audio arrives as an uploaded file either way — the offline path already
  requires that, and live capture writes the same material row.
- Extraction, chunking, anchors, and job status are identical whichever engine
  wins.
- `SpeechToTextProvider` is an interface Phase 2 never calls.

So Phase 2 is genuinely independent work, and running it in parallel costs
nothing if the benchmark forces a change. **No architectural decision in this
plan is contingent on the ASR outcome** — the contingent items are listed in §7
and all sit in Phase 3.

## 1. Scope

| # | Deliverable | Notes |
|---|---|---|
| 1 | Lecture CRUD | Belongs to a course offering; owner-scoped via the existing permission layer |
| 2 | Object storage behind `StorageProvider` | MinIO locally, S3/R2 in production |
| 3 | Resumable upload sessions | `client_ref` idempotency, byte-offset resume, checksum verification |
| 4 | Material records and lifecycle | `processing_status` visible end to end |
| 5 | Extraction — PDF, PPTX, DOCX, images, text | One `Extractor` per type behind a common interface |
| 6 | `material_chunks` with anchors | Page, slide, or character offset from birth |
| 7 | Python ingestion tier | First appearance; FastAPI + job runner |
| 8 | Postgres job queue | `SELECT … FOR UPDATE SKIP LOCKED`, retries, dead-lettering |
| 9 | Contract generation TS → Pydantic | The TS/Python seam, generated not hand-written |
| 10 | Retention plumbing | `retention_expires_at` set at upload from the term end date |

**Out of scope:** transcription, embeddings, search, any AI call. Extraction
produces text and anchors; nothing interprets them yet.

## 2. Schema

All of it is already designed in [DATABASE.md](../DATABASE.md) §4–6 and §15.
Migration `0001` adds: `lectures`, `lecture_sessions`, `materials`,
`material_chunks`, `upload_sessions`, `processing_jobs`, and the
`academic_terms` rows retention needs.

`content_chunks` is **not** in this migration. It is the retrieval unit, it
carries the embedding column, and [MVP.md](../MVP.md) freezes its shape at the
end of this phase — creating it before its consumers exist invites a second
migration over embedded data, which is the expensive kind.

Two open items from [ARCHITECTURE.md](../ARCHITECTURE.md) §11 must be settled
first, both small:

1. **Term boundaries** — seeded per university, or entered by the student?
   Retention keys off `academic_terms.ends_on`, so a course with no term has no
   expiry date. Recommendation: student-entered with a sensible default, since
   courses are already student-owned.
2. **Storage lifecycle** — who runs the nightly expiry sweep, and where it logs.

## 3. The TypeScript/Python seam

The first real test of the decision in [ARCHITECTURE.md](../ARCHITECTURE.md)
§3.2, and the place this phase is most likely to go wrong.

```
packages/contracts (Zod)  ──build──▶  JSON Schema  ──generate──▶  Pydantic models
```

Rules, so the seam does not rot:

- Neither side hand-writes the other's types.
- Generated files are committed and CI fails if regenerating them produces a diff.
- A contract test asserts both sides accept the same fixture payloads.
- The Python tier reads and writes the same tables via SQLAlchemy Core and
  **never** defines or alters schema — Drizzle stays the sole owner.

## 4. Upload, in the order it actually runs

```
client:  compute client_ref + sha256  →  POST /uploads
server:  create material (pending_upload) + upload_session
client:  PUT parts from received_bytes onward
server:  verify checksum  →  POST /uploads/{id}/complete  →  enqueue extract
worker:  extract → chunk → mark ready   (each step its own job)
```

The two failure modes worth designing tests around before writing the code:

- **Interrupted upload** — kill the client mid-transfer, resume, confirm the
  bytes are not re-sent from zero and the file is intact.
- **Ambiguous retry** — complete an upload, replay the same `client_ref`,
  confirm one material exists and not two.

Both are covered by `UNIQUE (user_id, client_ref)` on `materials` and
`upload_sessions`, but a constraint that is never exercised is a constraint
nobody knows is wrong.

## 5. Extraction

| Type | Library | Anchor | Risk |
|---|---|---|---|
| PDF (text layer) | PyMuPDF | `page_no` | — |
| PDF (scanned) | OCR fallback | `page_no` | Arabic OCR quality; best-effort |
| PPTX | python-pptx (incl. speaker notes) | `slide_no` | — |
| DOCX | python-docx | `char_offset` | — |
| Images | OCR | whole-object | Handwriting is best-effort, and said so |
| Text | direct | `char_offset` | — |

A material that fails extraction reports **which stage failed and why** — "no
text layer; OCR produced no output" — never a generic error. The student's next
action depends on knowing whether to re-upload, re-scan, or give up.

## 6. Exit criteria

1. Two courses from unrelated disciplines hold uploaded materials of every
   supported type, extracted, entirely through the UI.
2. An interrupted upload resumes from its byte offset; a replayed `client_ref`
   produces one material.
3. Every `material_chunk` carries a resolvable anchor — enforced by the schema,
   verified by a test.
4. Job status is visible in the UI for every stage, including failures.
5. Regenerating the Pydantic models produces no diff in CI.
6. `content_chunks` and the citation contract are frozen and documented.

## 7. What waits for the benchmark

| Item | Waits for | Why |
|---|---|---|
| Engine choice and packaging | §7 outcome | Which binary or module ships |
| Live WebSocket transcription tier | RTF gate | May not exist at all under $0 + no GPU |
| Two-tier live/batch split | RTF gate | Fast model live, accurate model on upload |
| Draft/final rendering | Live tier | Nothing to draft if there is no live tier |
| Audio preprocessing chain | Engine choice | Some engines want 16 kHz mono; others differ |

All five are Phase 3. None of them blocks a line of Phase 2 work.

## 8. Sequence

1. Settle the two open items in §2.
2. Migration `0001` and the storage provider.
3. Upload sessions, with the interrupt and replay tests written first.
4. Python tier skeleton and the generated-contract pipeline.
5. Job queue and status surfacing.
6. Extractors, one type at a time, PDF first.
7. Freeze `content_chunks` and the citation contract.
