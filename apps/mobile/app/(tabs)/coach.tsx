import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiGet, apiSend } from '@/lib/api';
import { roadmapFor } from '@sanad/contracts/roadmap';
import { Button, ComingSoon, Empty, ErrorNote, Loading, Pill, s, theme } from '@/components/ui';

/**
 * Study coach: the week the student actually has, and the plan built from it.
 *
 * The scheduler already subtracted class, work and gym windows — nothing could
 * enter them, so the app used to invent a week of free evenings and plan over
 * commitments the student had never declared. This is the input surface for the
 * real thing.
 */

interface Session {
  id: string;
  startsAt: string;
  activityType: string;
  courseTitle: string | null;
  topicName: string | null;
}
interface Plan {
  planId: string;
  coachMessage: string;
  sessions: Session[];
}
interface Window {
  weekday: number;
  startTime: string;
  endTime: string;
  kind: string;
  isAvailable: boolean;
}
interface ExamDate {
  id: string;
  offeringId: string;
  courseTitle: string;
  title: string;
  examAt: string;
}
interface CourseOption {
  id: string;
  title: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KINDS = [
  { value: 'study', label: 'Free', available: true },
  { value: 'class', label: 'University', available: false },
  { value: 'work', label: 'Work', available: false },
  { value: 'gym', label: 'Gym', available: false },
  { value: 'other', label: 'Busy', available: false },
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Coach() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [windows, setWindows] = useState<Window[] | null>(null);
  const [exams, setExams] = useState<ExamDate[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [examCourse, setExamCourse] = useState<string | null>(null);
  const [examTitle, setExamTitle] = useState('');
  const [examDate, setExamDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [day, setDay] = useState(1);
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('study');
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('21:00');

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      apiGet<{ plan: Plan | null }>('/api/v1/me/study-plan'),
      apiGet<{ windows: Window[] }>('/api/v1/me/availability'),
      apiGet<{ exams: ExamDate[] }>('/api/v1/me/exam-dates'),
      apiGet<{ courses: CourseOption[] }>('/api/v1/courses'),
    ])
      .then(([planned, week, examList, courseList]) => {
        setPlan(planned.plan);
        setCourses(courseList.courses);
        setExamCourse((current) => current ?? courseList.courses[0]?.id ?? null);
        setWindows(
          week.windows.map((w) => ({
            ...w,
            startTime: w.startTime.slice(0, 5),
            endTime: w.endTime.slice(0, 5),
          })),
        );
        setExams(examList.exams);
      })
      .catch((caught) => {
        setWindows([]);
        setError(caught instanceof Error ? caught.message : 'Could not load your schedule.');
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** The whole week is replaced on save: a partial edit of a schedule is ambiguous. */
  async function persist(next: Window[]) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('/api/v1/me/availability', 'PUT', {
        windows: next.map((w) => ({
          weekday: w.weekday,
          startTime: w.startTime,
          endTime: w.endTime,
          kind: w.kind,
          isAvailable: w.isAvailable,
        })),
      });
      setWindows(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your week.');
      load();
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!TIME.test(from) || !TIME.test(to)) {
      setError('Times need to look like 18:00.');
      return;
    }
    if (to <= from) {
      setError('A window has to end after it starts.');
      return;
    }
    const template = KINDS.find((k) => k.value === kind);
    void persist([
      ...(windows ?? []),
      {
        weekday: day,
        startTime: from,
        endTime: to,
        kind,
        isAvailable: template?.available ?? false,
      },
    ]);
  }

  async function addExam() {
    if (!examCourse) {
      setError('Create a course first — an exam belongs to one.');
      return;
    }
    if (!DATE.test(examDate)) {
      setError('The exam date needs to look like 2026-06-14.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/v1/courses/${examCourse}/exam-dates`, 'POST', {
        title: examTitle.trim() || 'Exam',
        // Midday, so a timezone shift cannot move the exam to the day before.
        examAt: new Date(`${examDate}T12:00:00`).toISOString(),
      });
      setExamTitle('');
      setExamDate('');
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add that exam date.');
    } finally {
      setBusy(false);
    }
  }

  async function removeExam(exam: ExamDate) {
    setError(null);
    try {
      await apiSend(`/api/v1/courses/${exam.offeringId}/exam-dates/${exam.id}`, 'DELETE');
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove that exam date.');
    }
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<{ plan: Plan }>('/api/v1/me/study-plan', 'POST');
      setPlan(data.plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build a plan.');
    } finally {
      setBusy(false);
    }
  }

  if (windows === null) return <Loading label="Loading your schedule…" />;

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Study coach</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>
        Tell Sanad when you have class, work or the gym. It plans around them — it will
        never schedule study over a commitment.
      </Text>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <Text style={s.h2}>Your week</Text>
      <View style={s.card}>
        {windows.length === 0 ? (
          <Text style={s.muted}>Nothing declared yet. Add your first window below.</Text>
        ) : (
          [...windows]
            .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
            .map((slot, index) => (
              <View
                key={`${slot.weekday}-${slot.startTime}-${slot.kind}-${index}`}
                style={[s.spread, { marginBottom: 8 }]}
              >
                <View style={[s.row, { flex: 1 }]}>
                  <Text style={[s.body, { width: 40 }]}>{DAYS[slot.weekday]}</Text>
                  <Text style={s.timestamp}>
                    {slot.startTime}–{slot.endTime}
                  </Text>
                  <Pill
                    text={KINDS.find((k) => k.value === slot.kind)?.label ?? slot.kind}
                    tone={slot.isAvailable ? 'good' : 'neutral'}
                  />
                </View>
                <Pressable
                  // Sorting copies the array, not the entries, so identity still
                  // removes the row the student tapped and not a lookalike.
                  onPress={() => persist(windows.filter((entry) => entry !== slot))}
                  hitSlop={10}
                >
                  <Text style={{ color: theme.inkFaint, fontSize: 18 }}>×</Text>
                </Pressable>
              </View>
            ))
        )}
      </View>

      <Text style={s.h2}>Add a window</Text>
      <View style={s.card}>
        <Text style={s.label}>Day</Text>
        <View style={[s.row, { flexWrap: 'wrap', marginBottom: 10 }]}>
          {DAYS.map((name, index) => (
            <Pressable key={name} onPress={() => setDay(index)}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: day === index ? theme.accent : theme.line,
                }}
              >
                <Text style={{ color: day === index ? theme.accent : theme.inkSoft }}>{name}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>What</Text>
        <View style={[s.row, { flexWrap: 'wrap', marginBottom: 10 }]}>
          {KINDS.map((option) => (
            <Pressable key={option.value} onPress={() => setKind(option.value)}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: kind === option.value ? theme.accent : theme.line,
                }}
              >
                <Text style={{ color: kind === option.value ? theme.accent : theme.inkSoft }}>
                  {option.label}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>From</Text>
            <TextInput
              style={s.input}
              value={from}
              onChangeText={setFrom}
              placeholder="18:00"
              placeholderTextColor={theme.inkFaint}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>To</Text>
            <TextInput
              style={s.input}
              value={to}
              onChangeText={setTo}
              placeholder="21:00"
              placeholderTextColor={theme.inkFaint}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <Button label="Add to my week" variant="secondary" onPress={add} busy={busy} />
      </View>

      <Text style={s.h2}>Exams ahead</Text>
      <View style={s.card}>
        {exams.length === 0 ? (
          <Text style={[s.muted, { marginBottom: 10 }]}>
            None yet. The coach works backwards from these — without one, every topic has
            the same urgency.
          </Text>
        ) : (
          exams.map((exam) => (
            <View key={exam.id} style={[s.spread, { marginBottom: 8 }]}>
              <Text style={[s.body, { flex: 1 }]}>
                {exam.courseTitle} · {exam.title}
              </Text>
              <Text style={s.timestamp}>
                {new Date(exam.examAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
              <Pressable onPress={() => removeExam(exam)} hitSlop={10}>
                <Text style={{ color: theme.inkFaint, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
          ))
        )}

        {courses.length === 0 ? null : (
          <>
            <Text style={s.label}>Course</Text>
            <View style={[s.row, { flexWrap: 'wrap', marginBottom: 10 }]}>
              {courses.map((option) => (
                <Pressable key={option.id} onPress={() => setExamCourse(option.id)}>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: examCourse === option.id ? theme.accent : theme.line,
                    }}
                  >
                    <Text
                      style={{ color: examCourse === option.id ? theme.accent : theme.inkSoft }}
                    >
                      {option.title}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>What</Text>
                <TextInput
                  style={s.input}
                  value={examTitle}
                  onChangeText={setExamTitle}
                  placeholder="Midterm"
                  placeholderTextColor={theme.inkFaint}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>When</Text>
                <TextInput
                  style={s.input}
                  value={examDate}
                  onChangeText={setExamDate}
                  placeholder="2026-06-14"
                  placeholderTextColor={theme.inkFaint}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <Button label="Add exam date" variant="secondary" onPress={addExam} busy={busy} />
          </>
        )}
      </View>

      <Button
        label={plan ? 'Re-plan my week' : 'Plan my week'}
        onPress={build}
        busy={busy}
      />

      {plan ? (
        <View style={{ marginTop: 16 }}>
          <Text style={[s.body, { marginBottom: 12 }]}>{plan.coachMessage}</Text>
          {plan.sessions.slice(0, 12).map((session) => (
            <View key={session.id} style={s.card}>
              <View style={s.spread}>
                <Text style={s.timestamp}>
                  {new Date(session.startsAt).toLocaleString(undefined, {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Pill text={session.activityType} />
              </View>
              <Text style={[s.body, { fontWeight: '600', marginTop: 4 }]}>
                {session.topicName ?? 'Review'}
              </Text>
              <Text style={s.muted}>{session.courseTitle}</Text>
            </View>
          ))}
          {plan.sessions.length > 12 ? (
            <Text style={s.muted}>
              Showing the next 12 of {plan.sessions.length} planned sessions.
            </Text>
          ) : null}
        </View>
      ) : (
        <Empty
          title="No plan yet."
          hint="Declare your week above, add an exam date, then plan."
        />
      )}
      <Text style={[s.h2, { marginTop: 20 }]}>On the roadmap</Text>
      {roadmapFor('plan').map((item) => (
        <ComingSoon key={item.id} title={item.title} promise={item.promise} detail={item.detail} />
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
