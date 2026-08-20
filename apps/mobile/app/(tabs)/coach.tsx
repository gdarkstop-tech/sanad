import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { apiGet, apiSend } from '@/lib/api';
import { Button, Empty, ErrorNote, Pill, s } from '@/components/ui';

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

const EVENINGS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  startTime: '18:00',
  endTime: '22:00',
  kind: 'study' as const,
  isAvailable: true,
}));

export default function Coach() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{ plan: Plan | null }>('/api/v1/me/study-plan')
      .then((data) => setPlan(data.plan))
      .catch(() => undefined);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function build() {
    setBusy(true);
    setError(null);
    try {
      await apiSend('/api/v1/me/availability', 'PUT', { windows: EVENINGS });
      const data = await apiSend<{ plan: Plan }>('/api/v1/me/study-plan', 'POST');
      setPlan(data.plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build a plan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>Study coach</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>
        Plans your week around your weak topics and exam dates. The schedule is
        computed, not guessed.
      </Text>

      <Button label={plan ? 'Re-plan my week' : 'Plan my week'} onPress={build} busy={busy} />
      {error ? <ErrorNote message={error} /> : null}

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
        </View>
      ) : (
        <Empty
          title="No plan yet."
          hint="Answer some exam questions first — the coach uses your results to decide what needs work."
        />
      )}
    </ScrollView>
  );
}
