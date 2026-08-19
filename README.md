# Sanad — AI Academic Companion

> **Sanad is not just an AI note-taking app. It is a complete AI academic companion that supports students from the moment a lecture starts until they finish their exams.**

> **سند ليس مجرد تطبيق لتفريغ المحاضرات. سند رفيق أكاديمي متكامل يرافق الطالب من لحظة بدء المحاضرة وحتى انتهاء الامتحان.**

**Current state: Phase 1 (foundation) implemented. Phases 2–11 not started.**

---

## The journey

**Before the lecture → during the lecture → after the lecture → daily studying → exam preparation.**

Sanad listens to a lecture, organizes it, makes it searchable, answers questions about it with citations, and turns it into study material and a study plan. It becomes the student's searchable academic memory.

## Two rules the whole system is built around

**1. Every claim is traceable.** Every answer, summary, flashcard, and exam question points back to a lecture timestamp or a document page. When the student's materials don't cover a question, Sanad says so instead of inventing an answer. This is enforced in the schema and in code, not requested in a prompt.

**2. Sanad is course-agnostic.** No subject, department, topic, or vocabulary exists in application code. Everything academic is configurable data. A Chemistry course, a Business course, and a Medicine course all load with zero code changes — and CI fails the build if a subject term leaks into application code.

Demo courses are seed fixtures and benchmark datasets. Nothing more.

## Architecture documents

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, technology decisions and their alternatives, module map, provider abstraction, auth, risks |
| [DATABASE.md](DATABASE.md) | Full PostgreSQL schema with DDL, pgvector strategy, indexes, migrations, sizing |
| [API.md](API.md) | REST endpoints, WebSocket protocol for live transcription, SSE contract for grounded answers |
| [AI_PIPELINE.md](AI_PIPELINE.md) | ASR, term correction, retrieval, citation validation, emphasis detection, Exam Mode, deterministic scheduling |
| [MVP.md](MVP.md) | Scope, out-of-scope with reasons, phases 0–11 with exit criteria, demo narrative |
| [ASR_BENCHMARK.md](ASR_BENCHMARK.md) | Phase 0 evaluation protocol, metrics, decision thresholds |

Read them in that order. `ARCHITECTURE.md` §11 records the decisions taken and what remains open.

## Running it

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup, migrations, and tests.

## Technology

PostgreSQL 16 + pgvector as the single source of truth · TypeScript / Next.js as one responsive PWA for web and mobile · Python for the AI tier (from Phase 2) · S3-compatible object storage for binaries · hosted ASR and LLM, self-hosted open-source embeddings, all provider-abstracted.

Offline-first on the client: recording a lecture never requires a network, and downloaded content is readable without one.

Rationale, and what was rejected, in [ARCHITECTURE.md](ARCHITECTURE.md) §3.

## الخلاصة بالعربي

- **سند مش شات بوت.** الأساس هو قاعدة بيانات أكاديمية منظمة — نصوص المحاضرات، المواد، التوقيتات، الاسترجاع، والمصادر — والـ AI مكوّن واحد فوقها، مش النظام كله.
- **أي إجابة لازم يكون ليها مصدر** بالتوقيت أو رقم الصفحة، ولو المعلومة مش موجودة في مواد الطالب، سند يقول "مش لاقيها" بدل ما يخترع. ده متطبّق في قاعدة البيانات وفي الكود، مش مجرد تعليمات للموديل.
- **النظام يشتغل مع أي مادة.** مفيش أي مادة أو مصطلح أو موضوع مكتوب جوه الكود — كله بيانات قابلة للتعديل، وفيه فحص في الـ CI بيكسر الـ build لو أي مصطلح خاص بمادة معينة اتسرّب للكود.
- **الخطوة الأولى** هي تقييم دقة التفريغ الصوتي على تسجيلات حقيقية قبل بناء أي حاجة تانية، لأن كل حاجة في المنتج بتعتمد عليه.

التفاصيل الكاملة في المستندات فوق.
