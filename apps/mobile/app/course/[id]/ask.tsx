import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiSend } from '@/lib/api';
import { Button, ErrorNote, Pill, s, theme } from '@/components/ui';

interface Citation {
  chunkId: string;
  label: string;
  quote: string;
  lectureId: string | null;
}
interface Answer {
  answer: string;
  refused: boolean;
  citations: Citation[];
  meta: { generator: string; latencyMs: number };
}

export default function Ask() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (q.length < 3) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await apiSend<Answer>('/api/v1/ask', 'POST', { question: q, courseId: String(id) }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Ask Sanad</Text>
      <Text style={[s.muted, { marginBottom: 14 }]}>
        Answers come only from this course. If your materials don’t cover it,
        Sanad says so rather than guessing.
      </Text>

      <TextInput
        style={[s.input, { minHeight: 70 }]}
        value={question}
        onChangeText={setQuestion}
        multiline
        placeholder="What did the professor say about…"
        placeholderTextColor={theme.inkFaint}
      />
      <Button label="Ask" onPress={ask} busy={busy} />

      {error ? <ErrorNote message={error} /> : null}

      {result ? (
        <View style={{ marginTop: 18 }}>
          <View
            style={[
              s.card,
              { borderLeftWidth: 3, borderLeftColor: result.refused ? theme.inkFaint : theme.accent },
            ]}
          >
            {result.refused ? <Pill text="no supporting material" /> : null}
            <Text style={[s.body, { marginTop: result.refused ? 8 : 0 }]}>{result.answer}</Text>
          </View>

          {result.citations.length > 0 ? (
            <>
              <Text style={s.h2}>Sources</Text>
              {result.citations.map((citation) => (
                <Pressable
                  key={citation.chunkId}
                  style={s.card}
                  onPress={() => {
                    if (citation.lectureId) router.push(`/lecture/${citation.lectureId}`);
                  }}
                >
                  <Text style={s.timestamp}>{citation.label}</Text>
                  <Text style={s.quote}>“{citation.quote}”</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={[s.muted, { marginTop: 10 }]}>
            {result.meta.generator === 'none'
              ? 'No answer was generated — retrieval found insufficient evidence.'
              : `Evidence-based answer · ${result.meta.latencyMs} ms`}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
