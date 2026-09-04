import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { apiSend, primeCsrf } from '@/lib/api';
import {
  clearApiUrl,
  detectedApiUrl,
  getApiUrl,
  needsServerAddress,
  setApiUrl,
} from '@/lib/config';
import { Button, s, theme } from '@/components/ui';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An installed build has no Metro to ask for the address, and a laptop's LAN
  // address changes. Showing it — and letting it be corrected here — is the
  // difference between "the app is broken" and a ten-second fix.
  const [server, setServer] = useState(getApiUrl());
  const [editingServer, setEditingServer] = useState(needsServerAddress());
  // Nothing detected means nothing worth pre-filling: a student correcting
  // "10.0.2.2" is worse off than one typing into an empty field with a hint.
  const [serverDraft, setServerDraft] = useState(needsServerAddress() ? '' : getApiUrl());
  const [serverNote, setServerNote] = useState<string | null>(null);

  async function saveServer() {
    const saved = await setApiUrl(serverDraft);
    if (!saved) {
      setServerNote('That does not look like an address. Try 192.168.1.5:3000');
      return;
    }
    setServer(saved);
    setServerDraft(saved);
    setServerNote(null);
    setEditingServer(false);
    setError(null);
  }

  async function resetServer() {
    const detected = await clearApiUrl();
    setServer(detected);
    setServerDraft(detected);
    setServerNote(null);
  }

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
        <View style={{ marginTop: 20, borderTopColor: theme.line, borderTopWidth: 1, paddingTop: 14 }}>
          {editingServer ? (
            <>
              <Text style={s.label}>Server address</Text>
              <TextInput
                style={s.input}
                value={serverDraft}
                onChangeText={setServerDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="192.168.1.5:3000"
                placeholderTextColor={theme.inkFaint}
              />
              {serverNote ? <Text style={s.error}>{serverNote}</Text> : null}
              <Text style={s.muted}>
                The address of the computer running Sanad, on the same Wi-Fi as this phone.
              </Text>
              <View style={[s.row, { marginTop: 10 }]}>
                <Button label="Save" onPress={saveServer} style={{ flex: 1 }} />
                <Button
                  label="Detect"
                  variant="secondary"
                  onPress={resetServer}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : (
            <View style={s.spread}>
              <Text style={[s.muted, { flex: 1 }]}>Server: {server}</Text>
              <Text
                style={{ color: theme.accent, fontSize: 13 }}
                onPress={() => {
                  setServerDraft(server);
                  setEditingServer(true);
                }}
              >
                Change
              </Text>
            </View>
          )}
          {!editingServer && server !== detectedApiUrl() ? (
            <Text style={[s.muted, { marginTop: 4 }]}>Saved on this phone.</Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
