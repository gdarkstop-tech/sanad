import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { QueueItem } from '@sanad/offline';
import { subscribeToQueue, uploadQueue } from '@/lib/queue';
import { Button, Empty, Pill, s, theme } from '@/components/ui';

/**
 * The offline recording queue, made visible.
 *
 * A student must be able to see that last Tuesday's lecture has not uploaded
 * yet — a silent retry is indistinguishable from a lost recording.
 */
const LABEL: Record<QueueItem['status'], { text: string; tone: 'neutral' | 'good' | 'bad' | 'warn' }> = {
  recording: { text: 'recording', tone: 'warn' },
  queued: { text: 'waiting for network', tone: 'warn' },
  uploading: { text: 'uploading', tone: 'neutral' },
  processing: { text: 'transcribing', tone: 'neutral' },
  ready: { text: 'ready', tone: 'good' },
  failed: { text: 'failed', tone: 'bad' },
};

function percent(item: QueueItem): number {
  if (item.totalBytes === 0) return 0;
  return Math.round((item.uploadedBytes / item.totalBytes) * 100);
}

export default function Queue() {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => subscribeToQueue(setItems), []);

  return (
    <ScrollView style={s.screen}>
      <Text style={s.h1}>Recordings</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>
        Recordings are saved on your device first. They upload on their own when
        you have a connection.
      </Text>

      <View style={{ marginBottom: 12 }}>
        <Button
          label="Check for uploads now"
          variant="secondary"
          onPress={() => {
            void uploadQueue.drain();
            void uploadQueue.refreshProcessing();
          }}
        />
      </View>

      {items.length === 0 ? (
        <Empty title="Nothing recorded yet." hint="Open a course and press Record." />
      ) : null}

      {items.map((item) => {
        const label = LABEL[item.status];
        return (
          <View key={item.clientRef} style={s.card}>
            <View style={s.spread}>
              <Text style={[s.body, { fontWeight: '600', flex: 1 }]}>{item.title}</Text>
              <Pill text={label.text} tone={label.tone} />
            </View>

            <Text style={s.muted}>
              {(item.totalBytes / 1e6).toFixed(1)} MB
              {item.durationMs ? ` · ${Math.round(item.durationMs / 1000)}s` : ''}
            </Text>

            {item.status === 'uploading' || (item.status === 'queued' && item.uploadedBytes > 0) ? (
              <View style={{ marginTop: 8 }}>
                <View style={{ height: 6, backgroundColor: theme.line, borderRadius: 3 }}>
                  <View
                    style={{
                      height: 6,
                      width: `${percent(item)}%`,
                      backgroundColor: theme.accent,
                      borderRadius: 3,
                    }}
                  />
                </View>
                <Text style={[s.muted, { marginTop: 4 }]}>
                  {percent(item)}% uploaded — resumes from here, never restarts
                </Text>
              </View>
            ) : null}

            {item.lastError ? <Text style={s.error}>{item.lastError}</Text> : null}

            {item.status === 'failed' ? (
              <Button
                label="Retry upload"
                variant="secondary"
                style={{ marginTop: 8 }}
                onPress={() => void uploadQueue.retry(item.clientRef).then(() => uploadQueue.drain())}
              />
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
