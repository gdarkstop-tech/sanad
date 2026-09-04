import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { restoreSession } from '@/lib/api';
import { initApiUrl } from '@/lib/config';
import { startQueue, stopQueue } from '@/lib/queue';
import { ensureRecordingsDirectory } from '@/lib/adapters';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Loading, theme } from '@/components/ui';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Before anything can be requested, settle where to request it from: a
        // standalone build may have an address saved on this phone.
        await initApiUrl();
        await ensureRecordingsDirectory();
        await restoreSession();
        // The queue starts regardless of sign-in state: a recording made before
        // a session expired must still upload once the student signs back in.
        startQueue();
      } catch (caught) {
        // Whatever failed here, the app is still usable — and a splash screen
        // that never leaves is the worst way to report a problem.
        setFailure(caught instanceof Error ? caught.message : 'Sanad could not start.');
      } finally {
        setReady(true);
      }
    })();
    return () => stopQueue();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.ground, justifyContent: 'center' }}>
        <Loading label="Starting Sanad…" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {failure ? (
        <View style={{ backgroundColor: theme.surface, padding: 10 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{failure}</Text>
        </View>
      ) : null}
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.ink,
          contentStyle: { backgroundColor: theme.ground },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="register" options={{ title: 'Create account' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
