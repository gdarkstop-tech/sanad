import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { networkAdapter } from '@/lib/adapters';
import { theme } from './ui';

/**
 * Persistent offline indicator.
 *
 * Recording works offline, so the banner reassures rather than warns — a
 * student who thinks recording needs a network will not press record.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void networkAdapter.isOnline().then(setOnline);
    return networkAdapter.onChange(setOnline);
  }, []);

  if (online) return null;
  return (
    <View style={{ backgroundColor: theme.warn, paddingVertical: 6, paddingHorizontal: 12 }}>
      <Text style={{ color: '#1b1400', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
        Offline — you can still record. Uploads resume automatically.
      </Text>
    </View>
  );
}
