import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiGet } from '@/lib/api';
import { Loading, theme } from '@/components/ui';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    apiGet('/api/v1/auth/me')
      .then(() => router.replace('/(tabs)'))
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.ground, justifyContent: 'center' }}>
      <Loading />
    </View>
  );
}
