# API.md

API surface and contracts for Sanad.

**Status:** decisions finalized. §2, §3, and the reference-data endpoints are implemented (Phase 1); the rest are specified, not implemented.

---

## 1. Conventions

| Aspect | Decision |
|---|---|
| Style | REST over HTTPS, plus WebSocket for live transcription and SSE for streamed answers |
| Base path | `/api/v1` — the version is in the path so a breaking change is additive, not a coordinated deploy |
| Auth | httpOnly session cookie, `SameSite=Lax`. **Implemented.** A CSRF token on state-changing requests is planned and *not yet implemented* — `SameSite=Lax` blocks cross-site form POSTs, which covers the main vector but is not defence in depth |
| Content type | `application/json`; file bytes never pass through the API (§5) |
| IDs | UUIDv7 strings |
| Timestamps | RFC 3339 UTC (`2026-08-19T14:03:11Z`) |
| Errors | RFC 9457 `application/problem+json` |
| Pagination | Cursor-based: `?limit=&cursor=` → `{ items, next_cursor }`. Offsets drift under concurrent inserts. |
| Idempotency | `Idempotency-Key` header on POSTs that create billable or side-effecting work (uploads, generation) |
| Validation | One Zod schema per payload in `packages/contracts`, shared by the TS API and the Python tier ([ARCHITECTURE.md](ARCHITECTURE.md) §3.2) |

### Error shape

```json
{
  "type": "https://sanad.app/errors/insufficient-context",
  "title": "Not enough course material to answer",
  "status": 422,
  "detail": "No content in this course scored above the retrieval threshold.",
  "instance": "/api/v1/qa/ask",
  "extensions": { "top_score": 0.21, "threshold": 0.35, "suggested_topics": ["…"] }
}
```

Refusal is a **successful** response (§7), not an error. This error type covers the narrower case where a request cannot even be attempted.

### Permission model

Every handler resolves `(subject, resource, action)` through `packages/core/permissions` ([ARCHITECTURE.md](ARCHITECTURE.md) §7). Handlers never write their own ownership checks.

Unauthorized access to an existing resource returns **404, not 403**, when revealing existence would itself leak information — a student probing another student's lecture IDs learns nothing.

---

## 2. Authentication

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create account with role and profile fields (§20 of the brief) |
| `POST` | `/auth/login` | Issue session cookie |
| `POST` | `/auth/logout` | Revoke current session |
| `GET` | `/auth/me` | Current user, role, profile, locale |
| `PATCH` | `/auth/me` | Update display name, interface locale, timezone |
| `POST` | `/auth/verify-email` | Confirm university email |

```http
POST /api/v1/auth/register
{
  "email": "student@university.edu",
  "password": "…",
  "full_name": "…",
  "role": "student",
  "interface_locale": "ar",              // preferred application language
  "profile": {
    "university":       { "id": "…" } | { "name": "…", "country": "…" },
    "faculty":          { "id": "…" } | { "name": "…" },
    "department":       { "id": "…" } | { "name": "…" },   // optional
    "academic_year_id": "…",
    "major":            "…",             // optional free text
    "student_number":   "…"              // optional
  }
}
```

**Reference data may be created inline.** Each of `university`, `faculty`, and `department` accepts either an existing ID or a name to create. Entries created this way are marked unverified ([DATABASE.md](DATABASE.md) §3). Without this, registration deadlocks on empty reference tables — nobody can register until someone already has.

Email and password only. Federated providers are anticipated in the schema (`auth_identities`) but not exposed.

Failures are indistinguishable between "no such account" and "wrong password", and always pay the cost of a hash verification so response time does not reveal which it was. **Implemented.** Per-IP and per-email rate limiting is specified but *not yet implemented* — see the known issues in the Phase 1 report.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/reference/universities?q=` | Search, for the registration picker |
| `GET` | `/reference/universities/{id}/faculties` | |
| `GET` | `/reference/faculties/{id}/departments` | |
| `GET` | `/reference/universities/{id}/academic-years` | |

---

## 3. Academic structure

| Method | Path | Notes |
|---|---|---|
| `GET` | `/universities` | Search/paginate |
| `GET` | `/universities/{id}/faculties` | |
| `GET` | `/faculties/{id}/departments` | |
| `GET` | `/universities/{id}/academic-years` | |
| `POST` | `/courses` | Create a course + its first offering, in one transaction |
| `GET` | `/courses` | Courses the caller owns or is enrolled in |
| `GET` | `/courses/{offeringId}` | **`offeringId` throughout** — see below |
| `PATCH` | `/courses/{offeringId}` | Title, language hints, question profile — **owner only** |
| `DELETE` | `/courses/{offeringId}` | Soft delete — **owner only** |
| `POST` | `/courses/{offeringId}/enroll` | |
| `GET` | `/courses/{offeringId}/members` | Enrolled students |

**Students own their courses.** `POST /courses` sets `owner_user_id` to the caller and creates one offering for the current term; update and delete require ownership. Instructors and TAs have accounts but no course-management permissions in the MVP ([ARCHITECTURE.md](ARCHITECTURE.md) §7). A non-owner attempting update or delete receives 404 rather than 403, per §1.

```jsonc
// POST /api/v1/courses
{
  "title": "Physics",                  // any subject; nothing is enumerated server-side
  "code": "PHY101",                    // optional
  "department_id": "…",                // optional
  "primary_language": "ar",
  "secondary_languages": ["en"],
  "term": { "id": "…" } | { "label": "Fall 2026" }
}
```

**Naming note.** The API says "course" where the database says "offering" ([DATABASE.md](DATABASE.md) §3). Students think in terms of the course they are taking this term; the catalogue/offering split is an internal concern and is not pushed into the client vocabulary.

---

## 4. Lectures and live transcription

### REST

| Method | Path | Notes |
|---|---|---|
| `POST` | `/courses/{offeringId}/lectures` | Create lecture |
| `GET` | `/courses/{offeringId}/lectures` | List with status and summary presence |
| `GET` | `/lectures/{id}` | Full lecture object |
| `PATCH` | `/lectures/{id}` | Title, sequence, date |
| `DELETE` | `/lectures/{id}` | Soft delete |
| `POST` | `/lectures/{id}/sessions` | Open a capture session → returns `ws_url`, `session_id` |
| `POST` | `/lectures/{id}/sessions/{sid}/close` | Finalize; enqueues enrichment |
| `GET` | `/lectures/{id}/transcript` | Segments with anchors; `?language=` selects display language |
| `GET` | `/lectures/{id}/transcript/raw` | Raw ASR output — never destroyed (§5 of the brief) |
| `GET` | `/lectures/{id}/emphasis` | Detected emphasis records |
| `GET` | `/lectures/{id}/summary` | Current summary |
| `POST` | `/lectures/{id}/summary/regenerate` | Supersedes; prior versions retained |

```jsonc
// GET /lectures/{id}/transcript
{
  "lecture": { "id": "…", "title": "Lecture 04", "course": { "id": "…", "title": "…" } },
  "segments": [
    {
      "id": "…", "seq": 412,
      "t_start_ms": 1394000, "t_end_ms": 1401500,
      "text": "…",              // display text (corrected)
      "raw_text": "…",          // as recognized
      "language": "mixed",
      "is_code_switched": true,
      "confidence": 0.91, "confidence_band": "high",
      "corrections": [
        { "raw_term": "…", "corrected_term": "…", "method": "lexicon", "confidence": 0.96,
          "char_start": 7, "char_end": 15 }
      ]
    }
  ],
  "next_cursor": "…"
}
```

### WebSocket — `/ws/lectures/{sessionId}`

Authenticated by session cookie at upgrade; the session must belong to the caller and be open.

**Client → server**

```jsonc
{ "type": "start",  "sample_rate": 16000, "encoding": "pcm_s16le", "language_hints": ["ar","en"] }
{ "type": "audio",  "seq": 41, "data": "<base64 pcm>" }
{ "type": "stop" }
```

**Server → client**

```jsonc
// interim hypothesis — rendered as draft, never persisted
{ "type": "draft", "t_start_ms": 1394000, "text": "…", "confidence": 0.62 }

// finalized segment — persisted, may still be corrected
{ "type": "segment", "segment_id": "…", "seq": 412,
  "t_start_ms": 1394000, "t_end_ms": 1401500,
  "text": "…", "confidence": 0.91, "confidence_band": "high", "is_code_switched": true }

// correction arriving after the segment was shown
{ "type": "correction", "segment_id": "…", "text": "…",
  "corrections": [ { "raw_term": "…", "corrected_term": "…", "char_start": 7, "char_end": 15 } ] }

// emphasis detected
{ "type": "emphasis", "segment_id": "…", "importance_type": "exam_relevant",
  "quote": "…", "confidence": 0.88 }

{ "type": "status", "state": "recording" | "reconnecting" | "closed" }
{ "type": "error",  "code": "asr_unavailable", "message": "…", "recoverable": true }
```

#### Transcript language selection

`GET /lectures/{id}/transcript?language=zh` returns Chinese if cached. If not, it **returns the source transcript immediately** and enqueues a per-lecture translation job:

```jsonc
{
  "language": { "requested": "zh", "served": "ar", "status": "generating", "job_id": "…" },
  "segments": [ /* source text */ ]
}
```

The client polls the job and re-fetches. Translation is generated on demand for the language the student actually selected — not pre-generated for every supported language ([DATABASE.md](DATABASE.md) §4). `GET /lectures/{id}/transcript/raw` is always the untranslated, uncorrected original.

Supported languages come from configuration (`GET /config/languages`), initially Arabic, English, and Chinese.

#### WebSocket properties the client depends on

Three properties:

- **Drafts are replaced, never appended.** A `segment` supersedes any draft overlapping its time range.
- **Corrections arrive out of band.** The UI must be able to mutate an already-rendered segment in place — this is what makes term correction visible rather than hidden.
- **Reconnection is expected.** On reconnect the client sends the last `segment_id` it holds and the server replays from there. Audio during a disconnect is buffered client-side up to a bounded window and flushed on resume; beyond that window the gap is reported honestly in the transcript rather than silently dropped.

---

## 5. Materials

Bytes never pass through the API (§18 of the brief).

| Method | Path | Notes |
|---|---|---|
| `POST` | `/uploads` | Open an upload session → `{ upload_session_id, material_id, chunk_size, received_bytes }` |
| `PUT` | `/uploads/{id}/parts/{n}` | Upload one part; **or** a presigned direct-to-storage URL |
| `GET` | `/uploads/{id}` | `{ received_bytes, parts, status }` — where to resume from |
| `POST` | `/uploads/{id}/complete` | Verify checksum, finalize, enqueue processing |
| `DELETE` | `/uploads/{id}` | Abort |
| `GET` | `/materials/{id}` | Metadata + `processing_status` + `processing_error` |
| `GET` | `/courses/{offeringId}/materials` | List, filterable by type and lecture |
| `GET` | `/materials/{id}/download-url` | Short-lived presigned read URL |
| `DELETE` | `/materials/{id}` | Soft delete; storage object swept asynchronously |

### Resumable and idempotent, because uploads start offline

A lecture recorded without a network is uploaded later, possibly over a bad connection, possibly more than once ([ARCHITECTURE.md](ARCHITECTURE.md) §3.10).

```jsonc
// POST /api/v1/uploads
{
  "client_ref": "…",            // generated on the device BEFORE recording starts
  "offering_id": "…",
  "lecture_id": "…",            // optional
  "kind": "lecture_recording",
  "filename": "…", "mime_type": "audio/webm",
  "total_bytes": 41288192,
  "checksum_sha256": "…"
}
```

**`client_ref` is the idempotency key.** Re-opening a session with the same `client_ref` returns the *existing* session and its `received_bytes` — so an ambiguous network failure resolves to a resume, never a duplicate lecture. The client uploads from `received_bytes` onward; `GET /uploads/{id}` answers "where did I get to?" after an app restart.

Checksum mismatch on completion fails the session rather than ingesting a corrupted recording.

### Offline content

| Method | Path | Notes |
|---|---|---|
| `GET` | `/courses/{offeringId}/offline-manifest` | Everything needed to use this course offline: transcript, summaries, flashcards, questions, notes, material and recording URLs, with sizes and content hashes |
| `GET` | `/me/sync-state` | Server-side view of queued and processing uploads |

The manifest returns hashes so the client re-downloads only what changed. Sync states — `queued`, `uploading`, `processing`, `ready`, `failed` — are user-facing: a student must be able to see that last Tuesday's lecture has not uploaded yet.

Progress is polled from `processing_status`; a failed material returns a specific reason ("no text layer; OCR failed"), never a generic error, because the student's next action depends on which stage failed.

---

## 6. Search

```http
GET /api/v1/search?q=…&course_id=…&types=transcript,material&limit=20
```

```jsonc
{
  "query": "…",
  "query_language": "ar",
  "expanded_terms": ["…"],          // canonical terms the query matched — cross-lingual bridge
  "results": [
    {
      "chunk_id": "…",
      "score": 0.83,
      "source_type": "transcript",
      "snippet": "…",
      "course":  { "id": "…", "title": "…" },
      "lecture": { "id": "…", "title": "Lecture 04", "sequence_no": 4 },
      "anchor":  { "t_start_ms": 1394000, "t_end_ms": 1401500 },
      "deep_link": "/lectures/{id}?t=1394",
      "confidence": 0.91
    },
    {
      "chunk_id": "…",
      "score": 0.77,
      "source_type": "material",
      "snippet": "…",
      "material": { "id": "…", "title": "…", "type": "pdf" },
      "anchor":  { "page_no": 18 },
      "deep_link": "/materials/{id}?page=18"
    }
  ],
  "related_topics": [ { "id": "…", "name": "…" } ],
  "next_cursor": null
}
```

Every result carries a resolvable anchor and a deep link. `?course_id` is optional — omitting it searches everything the student is enrolled in, which is what "one search engine for everything" requires.

---

## 7. Grounded Q&A

```http
POST /api/v1/qa/ask
{
  "conversation_id": "…",        // optional
  "course_id": "…",              // optional; scopes retrieval
  "lecture_id": "…",             // optional; narrows further
  "question": "…",
  "language": "ar"               // answer language; independent of source language
}
```

Streams SSE. **The events mirror the pipeline stages** ([AI_PIPELINE.md](AI_PIPELINE.md) §6), so the UI can show retrieval happening rather than an opaque wait:

```
event: retrieval
data: {"chunk_count":8,"top_score":0.71,"sources":[{"chunk_id":"…","preview":"…"}]}

event: delta
data: {"text":"…"}

event: citations
data: {"citations":[
  {"chunk_id":"…","quote":"…","validated":true,
   "anchor":{"lecture_id":"…","lecture_title":"Lecture 04","t_start_ms":1457000},
   "deep_link":"/lectures/…?t=1457"}
]}

event: done
data: {"message_id":"…","refused":false,"model":"…","latency_ms":2140}
```

### Refusal is a normal response

```
event: refusal
data: {
  "reason": "below_threshold",
  "message": "I couldn't find this information in your course materials.",
  "top_score": 0.19,
  "threshold": 0.35,
  "suggestions": [ { "type": "topic", "id": "…", "name": "…" } ]
}

event: done
data: {"message_id":"…","refused":true}
```

HTTP 200. The client renders a refusal, not an error state — and no `delta` events are emitted at all, because on a refusal the model is never called.

**Contract guarantee:** every `chunk_id` in a `citations` event appeared in the `retrieval` event of the same response. Citations are validated server-side against the retrieved set before emission; unvalidated ones are dropped, and if none survive the response converts to a refusal ([AI_PIPELINE.md](AI_PIPELINE.md) §6.4).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/qa/conversations` | List |
| `GET` | `/qa/conversations/{id}` | Messages with stored citations |
| `DELETE` | `/qa/conversations/{id}` | |
| `GET` | `/citations/{id}/resolve` | Anchor → playable/viewable location |

---

## 8. Study content and Exam Mode

| Method | Path | Notes |
|---|---|---|
| `GET` | `/courses/{offeringId}/topics` | Derived topics with mastery overlay |
| `GET` | `/courses/{offeringId}/flashcards` | Filter by topic, due date |
| `POST` | `/flashcards/{id}/review` | `{ "rating": 0-3 }` → updates review state and mastery |
| `GET` | `/courses/{offeringId}/questions` | Filter by topic, type, difficulty |
| `POST` | `/courses/{offeringId}/exams` | **Generate** — async, returns job |
| `GET` | `/exams/{id}` | Exam with items; each item carries its source citation |
| `POST` | `/exams/{id}/attempts` | Start an attempt |
| `POST` | `/attempts/{id}/answers` | Submit one answer; grading is immediate |
| `POST` | `/attempts/{id}/complete` | Finalize → triggers mastery update |
| `GET` | `/attempts/{id}/results` | Per-question correctness, explanation, source |

```jsonc
// POST /courses/{offeringId}/exams
{
  "mode": "practice",
  "config": {
    "question_types": ["mcq","short_answer","written"],
    "count": 25,
    "topic_ids": [],                    // empty = whole course
    "emphasis_weight": 2.0,             // how strongly instructor-flagged content is favored
    "weak_topic_weight": 1.5            // how strongly the student's weak topics are favored
  }
}
// → 202 { "job_id": "…", "exam_id": "…", "status": "pending" }
```

Both weights are **configuration, not code**, and both default to values in the course's `question_profile`. Nothing about how an exam is composed is subject-specific.

---

## 9. Learning memory and study coach

| Method | Path | Notes |
|---|---|---|
| `GET` | `/me/mastery?course_id=` | Per-topic mastery, accuracy, weak flags |
| `GET` | `/me/progress` | Lectures, reviews, streaks across courses |
| `GET` | `/me/availability` | Weekly availability blocks |
| `PUT` | `/me/availability` | Replace the week wholesale |
| `GET`/`POST`/`DELETE` | `/me/commitments` | One-off commitments |
| `GET`/`POST` | `/courses/{offeringId}/exam-dates` | Exam dates driving urgency |
| `POST` | `/me/study-plan/generate` | Deterministic scheduler run |
| `GET` | `/me/study-plan` | Active plan with sessions |
| `POST` | `/study-sessions/{id}/complete` | `{ actual_minutes, difficulty_felt? }` → replan |
| `POST` | `/study-sessions/{id}/skip` | → replan |
| `GET` | `/me/next-session` | Single recommendation for the dashboard |

```jsonc
// GET /me/study-plan
{
  "plan_id": "…",
  "generated_at": "…",
  "generator_version": "scheduler-1",
  "sessions": [
    {
      "id": "…", "starts_at": "…", "ends_at": "…",
      "course": { "id": "…", "title": "…" },
      "topic":  { "id": "…", "name": "…" },
      "activity_type": "review",
      "priority_score": 0.82,
      "rationale": { "mastery": 0.31, "days_to_exam": 4, "days_since_review": 9 }
    }
  ],
  "coach_message": "…"
}
```

**`rationale` carries the numbers the scheduler actually used.** `coach_message` is the only LLM-authored field in the response; it explains the plan and never determines it (§15 of the brief). The plan is fully reproducible from `constraints_snapshot` and `generator_version` without any model call.

---

## 10. Jobs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/jobs/{id}` | `{ status, progress, error }` |
| `GET` | `/jobs?target_type=&target_id=` | Jobs for a resource |

Every long-running operation returns `202` with a `job_id`. There is no endpoint that blocks on model work.

---

## 11. Internal contract: application tier ↔ AI tier

Not public. Service-token authenticated, never reachable from the internet.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/internal/asr/stream` | WebSocket relay for live recognition |
| `POST` | `/internal/ingest/extract` | Extract text + anchors from a stored file |
| `POST` | `/internal/embed` | Batch embed texts |
| `POST` | `/internal/enrich/summarize` | Summary for a scope |
| `POST` | `/internal/enrich/emphasis` | Emphasis detection over segments |
| `POST` | `/internal/enrich/generate` | Flashcards / questions with source references |

Every payload is defined once in `packages/contracts` and validated on both sides. A contract change that only one side adopts fails CI ([ARCHITECTURE.md](ARCHITECTURE.md) §3.2).

---

## 12. Non-functional expectations

| Concern | Target |
|---|---|
| Live transcription | draft ≤ 2 s, finalized ≤ 6 s after speech pause |
| Search | p95 < 400 ms |
| Q&A first token | p95 < 3 s |
| Exam generation | async; minutes are acceptable |
| Search query embedding | ≤ 120 ms on CPU (int8 ONNX) — inside the search budget |
| Offline recording | works with **no network**; capture never blocks on a request |
| Upload resume | resumes from `received_bytes`; retry with the same `client_ref` never duplicates |
| Rate limits | per user and per endpoint class; generation endpoints limited separately from reads |
| Audit | every AI call logged with model, tokens, latency, cost estimate; request ID propagated across tiers |
