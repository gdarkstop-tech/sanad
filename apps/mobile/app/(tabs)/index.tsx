import { useCallback, useState } from 'react';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ApiError, apiGet, apiSend, clearSession } from '@/lib/api';
import { contentCache } from '@/lib/queue';
import { Button, Empty, ErrorNote, Loading, Pill, s, theme } from '@/components/ui';

interface Course {
  id: string;
  title: string;
  code: string | null;
  primaryLanguage: string;
  isOwner: boolean;
}

export default function Courses() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiGet<{ courses: Course[] }>('/api/v1/courses')
      .then((data) => {
        setCourses(data.courses);
        setOffline(false);
      })
      .catch(async (caught) => {
        // A reply with a status is the server talking — a real error, not a
        // dead network — so it is reported rather than papered over.
        if (caught instanceof ApiError) {
          setCourses([]);
          setError(caught.message);
          return;
        }
        // This screen is the way in to everything else, so failing here would
        // put downloaded courses out of reach exactly when they are needed.
        setOffline(true);
        const cached = await contentCache.list();
        setCourses(
          cached.map((course) => ({
            id: course.courseId,
            title: course.title,
            code: null,
            primaryLanguage: 'downloaded',
            isOwner: true,
          })),
        );
        setError(
          cached.length > 0
            ? 'You are offline. Showing your downloaded courses.'
            : 'You are offline, and no course has been downloaded yet.',
        );
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function create() {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    try {
      await apiSend('/api/v1/courses', 'POST', { title: name, primaryLanguage: 'ar' });
      setTitle('');
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the course.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <View style={[s.spread, { marginBottom: 16 }]}>
        <Text style={s.h1}>Your courses</Text>
        <Pressable
          onPress={async () => {
            await clearSession();
            router.replace('/sign-in');
          }}
        >
          <Text style={{ color: theme.inkFaint }}>Sign out</Text>
        </Pressable>
      </View>

      {offline ? null : (
      <View style={s.card}>
        <Text style={s.h2}>Add a course</Text>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Any subject — Data Structures, Physiology…"
          placeholderTextColor={theme.inkFaint}
        />
        <Button label="Create course" onPress={create} busy={busy} />
      </View>
      )}

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {courses === null && !error ? <Loading /> : null}
      {courses?.length === 0 && !error ? (
        <Empty title="No courses yet." hint="Create one above, then record its first lecture." />
      ) : null}
      {courses?.length === 0 && offline ? (
        <Empty
          title="Nothing downloaded yet."
          hint="Open a course while online and choose “Download for offline”."
        />
      ) : null}


      {courses?.map((course) => (
        <Link key={course.id} href={`/course/${course.id}`} asChild>
          <Pressable style={s.card}>
            <View style={s.spread}>
              <Text style={[s.body, { fontWeight: '600', flex: 1 }]}>{course.title}</Text>
              <Pill text={course.primaryLanguage} />
            </View>
            {course.code ? <Text style={s.muted}>{course.code}</Text> : null}
          </Pressable>
        </Link>
      ))}
    </ScrollView>
  );
}
