import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { apiSend, primeCsrf } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { Button, s, theme } from '@/components/ui';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await primeCsrf();
      await apiSend('/api/v1/auth/login', 'POST', { email: email.trim(), password });
      router.replace('/(tabs)');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Sanad</Text>
      <Text style={[s.muted, { marginBottom: 20 }]}>
        Your lectures, searchable — and answerable with sources.
      </Text>

      <Text style={s.label}>University email</Text>
      <TextInput
        style={s.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@university.edu"
        placeholderTextColor={theme.inkFaint}
      />

      <Text style={s.label}>Password</Text>
      <TextInput
        style={s.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor={theme.inkFaint}
      />

      {error ? <Text style={s.error}>{error}</Text> : null}
      <Button label="Sign in" onPress={submit} busy={busy} />

      <View style={{ marginTop: 20 }}>
        <Link href="/register" style={{ color: theme.accent }}>
          Create an account
        </Link>
        <Text style={[s.muted, { marginTop: 16 }]}>Server: {API_URL}</Text>
      </View>
    </ScrollView>
  );
}
