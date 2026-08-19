# Sanad — AI Academic Companion

> **Sanad is not just an AI note-taking app. It is a complete AI academic companion that supports students from the moment a lecture starts until they finish their exams.**

> **سند ليس مجرد تطبيق لتفريغ المحاضرات. سند رفيق أكاديمي متكامل يرافق الطالب من لحظة بدء المحاضرة وحتى انتهاء الامتحان.**

---

## The story, in one line

**Before the lecture → during the lecture → after the lecture → daily studying → the exam.**

Sanad is not a bag of AI features. It is one loop that closes on itself:

1. **It listens.** Live Arabic/English transcription that survives code-switching and gets the technical terms right.
2. **It organizes.** Every lecture becomes a timestamped, searchable archive entry — transcript, recording, summary, key points, flashcards.
3. **It answers.** Ask anything about your course and get an answer grounded *only* in your own lectures and materials, with the exact timestamp or page.
4. **It coaches.** It knows which topics you're weak in and builds the study plan around your real calendar.
5. **It prepares you.** Exam Mode turns the whole semester into a practice exam with model answers.

Every step feeds the next. The transcript is what makes search work. Search is what makes grounded Q&A possible. Q&A performance is what tells the coach where you're weak. Weak topics are what Exam Mode drills.

## The rule that holds it together

**Every answer, summary, flashcard, and quiz question must point back to its source** — a lecture timestamp or a document page. If Sanad can't find it in your materials, it says so instead of inventing it.

This is the single most important product decision in the project. It is what makes Sanad an academic tool instead of a chatbot with a university theme.

## Scope

| | |
|---|---|
| **[Competition scope](docs/product-scope.md#competition-scope)** | The 8 things we are actually building, end to end, for one course |
| **[Stretch](docs/product-scope.md#stretch-only-if-the-core-is-finished-early)** | Built only if the core lands early |
| **[Future vision](docs/product-scope.md#future-vision-presented-not-built)** | Presented on slides, deliberately not built |

The first version goes deep on **one course — Digital Logic** — rather than shallow on ten. A judge who sees one subject work completely believes the second subject will work. A judge who sees ten subjects half-work believes none of them.

## Docs

| Document | What's in it |
|---|---|
| [`docs/product-scope.md`](docs/product-scope.md) | Every feature from the vision, with a build/don't-build verdict and the reason |
| [`docs/architecture.md`](docs/architecture.md) | How it actually works: transcription pipeline, retrieval, citations, mastery model |
| [`docs/demo-script.md`](docs/demo-script.md) | The 5-minute demo, beat by beat, with fallbacks |
| [`docs/build-plan.md`](docs/build-plan.md) | Build order, three parallel tracks, what to de-risk first |

## الخلاصة بالعربي

الفكرة كاملة ممتازة، بس مش كلها للمسابقة. القرار:

- **نبني 8 حاجات بس، لكن كاملة**: التفريغ الحي بالعربي/الإنجليزي، تصحيح المصطلحات التقنية، أرشيف المحاضرات، رفع أي ملف، البحث الموحّد، السؤال والجواب مع المصدر والتوقيت، وضع الامتحان، وخطة المذاكرة المرتبطة بالتقويم.
- **نأجّل**: المجتمع الطلابي، لوحة الـ TA، الأسئلة الشائعة، المحادثة الصوتية، والترجمة لعدة لغات — دي كلها في شرائح "الرؤية المستقبلية".
- **القاعدة الذهبية**: أي إجابة أو ملخص لازم يرجع لمصدره بالتوقيت أو رقم الصفحة، ولو المعلومة مش موجودة في مواد الطالب، سند يقول "مش لاقيها" بدل ما يخترع.
- **مادة واحدة بس** (Digital Logic) وتشتغل صح، أحسن من عشر مواد نصّها شغّال.

التفاصيل الكاملة في [`docs/product-scope.md`](docs/product-scope.md).
