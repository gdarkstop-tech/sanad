import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { apiGet, apiSend, clearSession } from '@/lib/api';
import { Button, ErrorNote, Loading, Pill, s, theme } from '@/components/ui';

interface Profile {
  user: { fullName: string; email: string; emailVerified: boolean };
  universityName: string | null;
  facultyName: string | null;
  departmentName: string | null;
  major: string | null;
  studentNumber: string | null;
}

/**
 * The student's academic identity.
 *
 * Free text rather than pickers: a dropdown of known universities locks out the
 * first student from anywhere new, and the server creates the reference row on
 * demand. Only what Sanad uses is asked for.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    universityName: '',
    facultyName: '',
    departmentName: '',
    major: '',
    studentNumber: '',
  });

  const load = useCallback(() => {
    setError(null);
    apiGet<{ profile: Profile }>('/api/v1/me/profile')
      .then((data) => {
        setProfile(data.profile);
        setForm({
          fullName: data.profile.user.fullName,
          universityName: data.profile.universityName ?? '',
          facultyName: data.profile.facultyName ?? '',
          departmentName: data.profile.departmentName ?? '',
          major: data.profile.major ?? '',
          studentNumber: data.profile.studentNumber ?? '',
        });
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not load your profile.'),
      );
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const data = await apiSend<{ profile: Profile }>('/api/v1/me/profile', 'PATCH', {
        fullName: form.fullName.trim(),
        universityName: form.universityName.trim() || null,
        facultyName: form.facultyName.trim() || null,
        departmentName: form.departmentName.trim() || null,
        major: form.major.trim() || null,
        studentNumber: form.studentNumber.trim() || null,
      });
      setProfile(data.profile);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!profile && !error) return <Loading label="Loading your profile…" />;

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder = '',
  ) => (
    <View key={key}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={form[key]}
        onChangeText={(value) => setForm({ ...form, [key]: value })}
        placeholder={placeholder}
        placeholderTextColor={theme.inkFaint}
        autoCapitalize="words"
      />
    </View>
  );

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Profile</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>
        Sanad asks only for what it uses: who you are, and where you study.
      </Text>

      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {saved && !error ? <Text style={[s.muted, { marginBottom: 8 }]}>Saved.</Text> : null}

      <View style={s.card}>
        <View style={[s.spread, { marginBottom: 10 }]}>
          <Text style={[s.body, { flex: 1 }]}>{profile?.user.email}</Text>
          <Pill
            text={profile?.user.emailVerified ? 'verified' : 'unverified'}
            tone={profile?.user.emailVerified ? 'good' : 'neutral'}
          />
        </View>

        {field('fullName', 'Name')}
        {field('universityName', 'University', 'Your university')}
        {field('facultyName', 'Faculty', 'Faculty of Engineering')}
        {field('departmentName', 'Department', 'Computer Engineering')}
        {field('major', 'Major')}
        {field('studentNumber', 'Student number')}

        <Button label="Save" onPress={save} busy={busy} />
      </View>

      <Button
        label="Sign out"
        variant="secondary"
        onPress={async () => {
          await clearSession();
          router.replace('/sign-in');
        }}
      />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
