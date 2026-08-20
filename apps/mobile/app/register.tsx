import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { apiSend, primeCsrf } from '@/lib/api';
import { Button, s, theme } from '@/components/ui';

export default function Register() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    university: '',
    faculty: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await primeCsrf();
      await apiSend('/api/v1/auth/register', 'POST', {
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        role: 'student',
        interfaceLocale: 'en',
        profile: {
          // The server creates missing reference data inline, so a student can
          // register before their university exists in the system.
          ...(form.university ? { university: { name: form.university.trim() } } : {}),
          ...(form.faculty ? { faculty: { name: form.faculty.trim() } } : {}),
        },
      });
      router.replace('/(tabs)');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Create your account</Text>
      <Text style={[s.muted, { marginBottom: 18 }]}>
        Your academic details help organize courses. You can change them later.
      </Text>

      {(
        [
          ['fullName', 'Full name', false],
          ['email', 'University email', false],
          ['password', 'Password (10 characters minimum)', true],
          ['university', 'University', false],
          ['faculty', 'College / faculty', false],
        ] as const
      ).map(([key, label, secure]) => (
        <View key={key}>
          <Text style={s.label}>{label}</Text>
          <TextInput
            style={s.input}
            value={form[key]}
            onChangeText={set(key)}
            secureTextEntry={secure}
            autoCapitalize={key === 'email' ? 'none' : 'sentences'}
            keyboardType={key === 'email' ? 'email-address' : 'default'}
            placeholderTextColor={theme.inkFaint}
          />
        </View>
      ))}

      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button label="Create account" onPress={submit} busy={busy} />
    </ScrollView>
  );
}
