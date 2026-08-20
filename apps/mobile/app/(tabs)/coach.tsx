import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiGet, apiSend } from '@/lib/api';
import { Button, Empty, ErrorNote, Loading, Pill, s, theme } from '@/components/ui';

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
  courseTitle: string;
  title: string;
  examAt: string;
}

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
    ])
      .then(([planned, week, examList]) => {
        setPlan(planned.plan);
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

      {exams.length > 0 ? (
        <>
          <Text style={s.h2}>Exams ahead</Text>
          <View style={s.card}>
            {exams.map((exam) => (
              <View key={exam.id} style={[s.spread, { marginBottom: 6 }]}>
                <Text style={[s.body, { flex: 1 }]}>
                  {exam.courseTitle} · {exam.title}
                </Text>
                <Text style={s.timestamp}>
                  {new Date(exam.examAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={[s.muted, { marginBottom: 12 }]}>
          No exam dates yet. Add one from a course on the web app — the coach works
          backwards from them.
        </Text>
      )}

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
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
