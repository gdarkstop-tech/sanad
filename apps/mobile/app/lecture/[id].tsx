import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { apiGet } from '@/lib/api';
import { contentCache } from '@/lib/queue';
import { Empty, ErrorNote, Loading, Pill, TranscriptSourceNote, s, theme } from '@/components/ui';

interface Segment {
  id: string;
  tStartMs: number;
  text: string;
  language: string | null;
  isCodeSwitched: boolean;
  confidenceBand: string | null;
}
interface Emphasis {
  id: string;
  tStartMs: number;
  quote: string;
  importanceType: string;
}

function stamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function Lecture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('Lecture');
  const [source, setSource] = useState<{ isSynthetic: boolean } | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [emphasis, setEmphasis] = useState<Emphasis[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{
      lecture: { title: string; transcription: { isSynthetic: boolean } | null };
      segments: Segment[];
      emphasis: Emphasis[];
    }>(`/api/v1/lectures/${id}/transcript`)
      .then((data) => {
        setTitle(data.lecture.title);
        setSource(data.lecture.transcription);
        setSegments(data.segments);
        setEmphasis(data.emphasis);
        setNotice(null);
      })
      .catch(async () => {
        // Offline: serve the downloaded copy if this course was saved.
        for (const course of await contentCache.list()) {
          const cached = course.lectures.find((lecture) => lecture.id === String(id));
          if (!cached) continue;
          setTitle(cached.title);
          setSegments(
            cached.segments.map((segment, index) => ({
              id: String(index),
              tStartMs: segment.tStartMs,
              text: segment.text,
              language: segment.language,
              isCodeSwitched: segment.language === 'mixed',
              confidenceBand: segment.confidenceBand,
            })),
          );
          setEmphasis(
            cached.emphasis.map((item, index) => ({
              id: String(index),
              tStartMs: item.tStartMs,
              quote: item.quote,
              importanceType: item.importanceType,
            })),
          );
          setNotice('Showing the downloaded transcript — you are offline.');
          return;
        }
        setNotice('This lecture is not downloaded, and you are offline.');
        setSegments([]);
      });
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (segments === null) return <Loading label="Loading transcript…" />;

  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>{title}</Text>
      <TranscriptSourceNote source={source} />
      {notice ? <ErrorNote message={notice} onRetry={load} /> : null}

      {emphasis.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={s.h2}>Flagged by the instructor</Text>
          {emphasis.map((item) => (
            <View key={item.id} style={s.card}>
              <View style={s.row}>
                <Pill text={item.importanceType.replace('_', ' ')} tone="good" />
                <Text style={s.timestamp}>{stamp(item.tStartMs)}</Text>
              </View>
              <Text style={s.quote}>“{item.quote}”</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={s.h2}>Transcript</Text>
      {segments.length === 0 ? (
        <Empty
          title="No transcript yet."
          hint="Once the recording uploads, Sanad processes it and the transcript appears here."
        />
      ) : null}

      {segments.map((segment) => (
        <View key={segment.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <Text style={[s.timestamp, { width: 46 }]}>{stamp(segment.tStartMs)}</Text>
          <Text
            style={[
              s.body,
              { flex: 1 },
              // Low-confidence passages are marked, never presented as certain.
              segment.confidenceBand === 'low'
                ? { color: theme.inkSoft, textDecorationLine: 'underline' }
                : null,
            ]}
          >
            {segment.text}
          </Text>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
