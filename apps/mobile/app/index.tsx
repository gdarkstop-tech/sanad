import { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { getApiUrl, needsServerAddress } from '@/lib/config';
import { Loading, theme } from '@/components/ui';

export default function Index() {
  const router = useRouter();

  // With no address to try, there is nothing to ask and no point waiting for an
  // answer. An installed build starts here every time, and a request to a
  // loopback address it inherited by default is the one request guaranteed to
  // fail — slowly, behind a spinner that says nothing.
  //
  // Declarative, not `router.replace()` in an effect. Navigating imperatively on
  // mount runs before the navigator exists and throws out of `assertIsReady`,
  // which in a release build is not an error message but a closing app.
  const needsAddress = needsServerAddress();

  useEffect(() => {
    if (needsAddress) return;
    apiGet('/api/v1/auth/me')
      .then(() => router.replace('/(tabs)'))
      .catch(() => router.replace('/sign-in'));
  }, [router, needsAddress]);

  if (needsAddress) return <Redirect href="/sign-in" />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground, justifyContent: 'center' }}>
      {/* Naming the address turns a stalled spinner into a diagnosis. */}
      <Loading label={`Contacting ${getApiUrl()}…`} />
    </View>
  );
}
