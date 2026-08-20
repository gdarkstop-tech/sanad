import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

export const theme = {
  ground: '#0d1415',
  surface: '#151e1f',
  line: '#263335',
  ink: '#e7eded',
  inkSoft: '#a3b3b3',
  inkFaint: '#718384',
  accent: '#4dc4cd',
  accentInk: '#06211f',
  danger: '#f6a6a6',
  warn: '#e0c06f',
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.ground, padding: 16 },
  h1: { color: theme.ink, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  h2: { color: theme.ink, fontSize: 17, fontWeight: '600', marginBottom: 8 },
  body: { color: theme.ink, fontSize: 15, lineHeight: 22 },
  muted: { color: theme.inkFaint, fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.line,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.ink,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 10,
    fontSize: 15,
  },
  label: { color: theme.inkSoft, fontSize: 13, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { color: theme.danger, fontSize: 14, marginVertical: 8 },
  quote: { color: theme.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 4 },
  timestamp: { color: theme.accent, fontSize: 13, fontVariant: ['tabular-nums'] },
});

export function Button({
  label,
  onPress,
  busy,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
}) {
  const background =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : 'transparent';
  const color = variant === 'secondary' ? theme.ink : theme.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={[
        {
          backgroundColor: background,
          borderColor: variant === 'secondary' ? theme.line : background,
          borderWidth: 1,
          borderRadius: 10,
          paddingVertical: 12,
          paddingHorizontal: 16,
          alignItems: 'center',
          opacity: busy ? 0.6 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={{ color, fontWeight: '600', fontSize: 15 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const color =
    tone === 'good' ? theme.accent : tone === 'bad' ? theme.danger : tone === 'warn' ? theme.warn : theme.inkFaint;
  return (
    <View style={{ borderColor: color, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' }}>{text}</Text>
    </View>
  );
}

/** Every list renders one of these rather than an ambiguous blank screen. */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ paddingVertical: 32, alignItems: 'center' }}>
      <Text style={[s.body, { color: theme.inkSoft, textAlign: 'center' }]}>{title}</Text>
      {hint ? <Text style={[s.muted, { marginTop: 6, textAlign: 'center' }]}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={{ paddingVertical: 32, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={theme.accent} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[s.card, { borderColor: theme.danger }]}>
      <Text style={s.error}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.h2}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * A feature that is designed but not built.
 *
 * Inert on purpose: no request, no spinner, no control that looks like it would
 * work under different circumstances. A preview that behaves like a broken
 * feature is worse than no preview.
 */
export function ComingSoon({
  title,
  promise,
  detail,
}: {
  title: string;
  promise: string;
  detail?: string;
}) {
  return (
    <View
      style={[
        s.card,
        { borderStyle: 'dashed', borderColor: theme.inkFaint, backgroundColor: 'transparent' },
      ]}
    >
      <View style={s.spread}>
        <Text style={[s.h2, { marginBottom: 0, flex: 1 }]}>{title}</Text>
        <Pill text="coming soon" />
      </View>
      <Text style={[s.body, { marginTop: 8 }]}>{promise}</Text>
      {detail ? <Text style={[s.muted, { marginTop: 6 }]}>{detail}</Text> : null}
    </View>
  );
}
