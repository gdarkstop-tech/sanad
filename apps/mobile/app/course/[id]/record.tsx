import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { apiSend } from '@/lib/api';
import { recordingsDirectory } from '@/lib/adapters';
import { uploadQueue } from '@/lib/queue';
import { Button, ErrorNote, Pill, s, theme } from '@/components/ui';

/**
 * Lecture recording.
 *
 * Nothing on the start path requires a network. `clientRef` is generated before
 * the first byte is captured, the file is written locally, and the queue takes
 * over afterwards — so a lecture recorded in a basement with no signal is safe.
 */
export default function Record() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = String(id);
  const router = useRouter();

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [title, setTitle] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<string | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    AudioModule.requestRecordingPermissionsAsync().catch(() =>
      setError('Sanad needs microphone access to record a lecture.'),
    );
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      // Created BEFORE recording: it is the server's idempotency key, and a
      // crash mid-recording must still leave a resumable queue entry.
      const ref = Crypto.randomUUID();
      clientRef.current = ref;

      let lectureId: string | null = null;
      try {
        const created = await apiSend<{ lecture: { id: string } }>(
          `/api/v1/courses/${courseId}/lectures`,
          'POST',
          { title: title.trim() || `Lecture ${new Date().toLocaleDateString()}` },
        );
        lectureId = created.lecture.id;
      } catch {
        // Offline: capture anyway. The recording attaches to a lecture when the
        // upload eventually runs; losing it would be far worse.
        lectureId = null;
      }

      await uploadQueue.registerRecording({
        clientRef: ref,
        localUri: `${recordingsDirectory}${ref}.m4a`,
        offeringId: courseId,
        lectureId,
        title: title.trim() || 'Untitled lecture',
        filename: 'lecture.m4a',
        mimeType: 'audio/mp4',
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start recording.');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await recorder.stop();
      setRecording(false);

      const ref = clientRef.current;
      if (!ref) return;
      const target = `${recordingsDirectory}${ref}.m4a`;

      // The recorder writes to a temporary path; move it to the durable one the
      // queue already knows about.
      if (recorder.uri && recorder.uri !== target) {
        await FileSystem.moveAsync({ from: recorder.uri, to: target });
      }

      await uploadQueue.finishRecording(ref, { durationMs: elapsed * 1000 });
      void uploadQueue.drain();
      router.replace('/(tabs)/queue');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the recording.');
    } finally {
      setBusy(false);
    }
  }

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  return (
    <ScrollView style={s.screen} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Record lecture</Text>
      <Text style={[s.muted, { marginBottom: 18 }]}>
        Recording does not need an internet connection. Sanad saves it on your
        device and uploads it when you are back online.
      </Text>

      {!recording ? (
        <>
          <Text style={s.label}>Lecture title (optional)</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Lecture 04"
            placeholderTextColor={theme.inkFaint}
          />
        </>
      ) : null}

      <View style={[s.card, { alignItems: 'center', paddingVertical: 28 }]}>
        {recording ? <Pill text="recording" tone="bad" /> : <Pill text="ready" />}
        <Text
          style={{ color: theme.ink, fontSize: 44, fontVariant: ['tabular-nums'], marginTop: 12 }}
        >
          {minutes}:{seconds}
        </Text>
      </View>

      {error ? <ErrorNote message={error} /> : null}

      {recording ? (
        <Button label="Stop and save" variant="danger" onPress={stop} busy={busy} />
      ) : (
        <Button label="● Start recording" onPress={start} busy={busy} />
      )}
    </ScrollView>
  );
}
