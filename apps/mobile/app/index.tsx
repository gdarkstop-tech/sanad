import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { getApiUrl, needsServerAddress } from '@/lib/config';
import { Loading, theme } from '@/components/ui';

export default function Index() {
  const router = useRouter();
  const [target] = useState(() => getApiUrl());

  useEffect(() => {
    // With no address to try, there is nothing to ask and no point waiting for
    // an answer. An installed build starts here every time, and a request to a
    // loopback address it inherited by default is the one request guaranteed to
    // fail — slowly, behind a spinner that says nothing.
    if (needsServerAddress()) {
      router.replace('/sign-in');
      return;
    }

    apiGet('/api/v1/auth/me')
      .then(() => router.replace('/(tabs)'))
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground, justifyContent: 'center' }}>
      {/* Naming the address turns a stalled spinner into a diagnosis. */}
      <Loading label={needsServerAddress() ? 'Loading…' : `Contacting ${target}…`} />
    </View>
  );
}
