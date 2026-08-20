import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { apiSend } from '@/lib/api';
import { Button, Empty, ErrorNote, Pill, s, theme } from '@/components/ui';

interface ExamPack {
  summary: string | null;
  keywords: string[];
  emphasis: Array<{ quote: string; lectureTitle: string | null; timestamp: string }>;
  weakTopics: Array<{ id: string; name: string; masteryScore: number }>;
  flashcards: Array<{ id: string; front: string; back: string }>;
  questions: Array<{
    id: string;
    type: string;
    stem: string;
    modelAnswer: string | null;
    sourceLabel: string;
  }>;
}

export default function Exam() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pack, setPack] = useState<ExamPack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiSend<{ exam: ExamPack }>(
        `/api/v1/courses/${id}/exam`,
        'POST',
        { questionCount: 10 },
      );
      setPack(data.exam);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build the exam pack.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) => setShown((current) => ({ ...current, [key]: !current[key] }));

  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>Exam Mode</Text>
      <Text style={[s.muted, { marginBottom: 14 }]}>
        Built from this course’s own lectures and materials. Every item shows
        where it came from.
      </Text>
      <Button label="Prepare me for the exam" onPress={generate} busy={busy} />
      {error ? <ErrorNote message={error} onRetry={generate} /> : null}

      {pack ? (
        <View style={{ marginTop: 18 }}>
          {pack.emphasis.length > 0 ? (
            <>
              <Text style={s.h2}>What the instructor flagged</Text>
              {pack.emphasis.map((item, index) => (
                <View key={index} style={s.card}>
                  <Text style={s.timestamp}>
                    {item.lectureTitle ?? 'Lecture'} — {item.timestamp}
                  </Text>
                  <Text style={s.quote}>“{item.quote}”</Text>
                </View>
              ))}
            </>
          ) : null}

          {pack.summary ? (
            <>
              <Text style={s.h2}>Course summary</Text>
              <View style={s.card}>
                <Text style={s.body}>{pack.summary}</Text>
              </View>
            </>
          ) : null}

          {pack.weakTopics.length > 0 ? (
            <>
              <Text style={s.h2}>Your weak areas</Text>
              <View style={[s.row, { flexWrap: 'wrap', marginBottom: 16 }]}>
                {pack.weakTopics.map((topic) => (
                  <Pill
                    key={topic.id}
                    tone="bad"
                    text={`${topic.name} ${Math.round(topic.masteryScore * 100)}%`}
                  />
                ))}
              </View>
            </>
          ) : null}

          {pack.flashcards.length > 0 ? (
            <>
              <Text style={s.h2}>Flashcards</Text>
              {pack.flashcards.slice(0, 6).map((card) => (
                <Pressable key={card.id} style={s.card} onPress={() => toggle(card.id)}>
                  <Text style={s.body}>{card.front}</Text>
                  <Text style={[s.timestamp, { marginTop: 8 }]}>
                    {shown[card.id] ? card.back : 'Tap to reveal'}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={s.h2}>Practice exam</Text>
          {pack.questions.length === 0 ? (
            <Empty title="No questions yet." hint="Add a lecture recording or a PDF first." />
          ) : null}
          {pack.questions.map((question, index) => (
            <Pressable key={question.id} style={s.card} onPress={() => toggle(question.id)}>
              <View style={s.spread}>
                <Text style={[s.body, { fontWeight: '600' }]}>{index + 1}.</Text>
                <Pill text={question.type.replace('_', ' ')} />
              </View>
              <Text style={[s.body, { marginTop: 6 }]}>{question.stem}</Text>
              {shown[question.id] && question.modelAnswer ? (
                <Text style={s.quote}>{question.modelAnswer}</Text>
              ) : (
                <Text style={[s.muted, { marginTop: 6 }]}>Tap to show the model answer</Text>
              )}
              <Text style={[s.muted, { marginTop: 8, color: theme.inkFaint }]}>
                Source: {question.sourceLabel}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
