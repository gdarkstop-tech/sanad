import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { apiGet } from '@/lib/api';
import { Button, Empty, ErrorNote, s, theme } from '@/components/ui';

interface Result {
  chunkId: string;
  snippet: string;
  label: string;
  sourceType: string;
  lecture: { id: string; title: string | null } | null;
  anchor: { tStartMs: number | null; pageNo: number | null };
}

export default function Search() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiGet<{ results: Result[] }>(
        `/api/v1/search?q=${encodeURIComponent(q)}&course_id=${id}`,
      );
      setResults(data.results);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Search</Text>
      <TextInput
        style={s.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={run}
        placeholder="A concept, a term, a phrase…"
        placeholderTextColor={theme.inkFaint}
        returnKeyType="search"
      />
      <Button label="Search" onPress={run} busy={busy} />

      {error ? <ErrorNote message={error} onRetry={run} /> : null}
      {results?.length === 0 ? (
        <Empty title="Nothing in your materials matches that." />
      ) : null}

      <View style={{ marginTop: 16 }}>
        {results?.map((result) => (
          <Pressable
            key={result.chunkId}
            style={s.card}
            onPress={() => {
              if (result.lecture?.id) router.push(`/lecture/${result.lecture.id}`);
            }}
          >
            <Text style={s.timestamp}>{result.label}</Text>
            <Text style={s.quote}>{result.snippet}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
