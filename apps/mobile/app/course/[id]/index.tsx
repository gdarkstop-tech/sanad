import { useCallback, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { apiGet } from '@/lib/api';
import { contentCache } from '@/lib/queue';
import { Button, Empty, ErrorNote, Loading, Pill, s, theme } from '@/components/ui';

interface Lecture {
  id: string;
  title: string;
  status: string;
  segmentCount: number;
  hasRecording: boolean;
}
interface Course {
  id: string;
  title: string;
}

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<Lecture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      apiGet<{ course: Course }>(`/api/v1/courses/${courseId}`),
      apiGet<{ lectures: Lecture[] }>(`/api/v1/courses/${courseId}/lectures`),
    ])
      .then(([c, l]) => {
        setCourse(c.course);
        setLectures(l.lectures);
      })
      .catch(async (caught) => {
        // Offline: fall back to whatever was downloaded for this course.
        const cached = await contentCache.read(courseId);
        if (cached) {
          setCourse({ id: cached.courseId, title: cached.title });
          setLectures(
            cached.lectures.map((lecture) => ({
              id: lecture.id,
              title: lecture.title,
              status: lecture.status,
              segmentCount: lecture.segments.length,
              hasRecording: false,
            })),
          );
          setError('Showing downloaded content — you are offline.');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Could not load this course.');
      });
  }, [courseId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function download() {
    setSaving(true);
    try {
      await contentCache.download(courseId, course?.title ?? 'Course');
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not download.');
    } finally {
      setSaving(false);
    }
  }

  if (!course && !error) return <Loading />;

  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>{course?.title ?? 'Course'}</Text>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}

      <View style={{ gap: 8, marginBottom: 20 }}>
        <Link href={`/course/${courseId}/record`} asChild>
          <Pressable>
            <Button label="● Record a lecture" onPress={() => {}} />
          </Pressable>
        </Link>
        <View style={s.row}>
          <Link href={`/course/${courseId}/search`} asChild>
            <Pressable style={{ flex: 1 }}>
              <Button label="Search" variant="secondary" onPress={() => {}} />
            </Pressable>
          </Link>
          <Link href={`/course/${courseId}/ask`} asChild>
            <Pressable style={{ flex: 1 }}>
              <Button label="Ask Sanad" variant="secondary" onPress={() => {}} />
            </Pressable>
          </Link>
        </View>
        <Link href={`/course/${courseId}/exam`} asChild>
          <Pressable>
            <Button label="Exam Mode" variant="secondary" onPress={() => {}} />
          </Pressable>
        </Link>
        <Button
          label={saved ? 'Downloaded for offline' : 'Download for offline'}
          variant="secondary"
          busy={saving}
          onPress={download}
        />
      </View>

      <Text style={s.h2}>Lecture archive</Text>
      {lectures?.length === 0 ? (
        <Empty title="No lectures yet." hint="Record one — it works without a connection." />
      ) : null}

      {lectures?.map((lecture) => (
        <Link key={lecture.id} href={`/lecture/${lecture.id}`} asChild>
          <Pressable style={s.card}>
            <View style={s.spread}>
              <Text style={[s.body, { fontWeight: '600', flex: 1 }]}>{lecture.title}</Text>
              <Pill
                text={lecture.status}
                tone={lecture.status === 'ready' ? 'good' : lecture.status === 'failed' ? 'bad' : 'neutral'}
              />
            </View>
            <Text style={s.muted}>
              {lecture.segmentCount > 0
                ? `Transcript ready · ${lecture.segmentCount} segments`
                : lecture.hasRecording
                  ? 'Recording uploaded, processing…'
                  : 'No recording yet'}
            </Text>
          </Pressable>
        </Link>
      ))}
      <View style={{ height: 40 }} />
      <Text style={[s.muted, { color: theme.inkFaint }]} />
    </ScrollView>
  );
}
