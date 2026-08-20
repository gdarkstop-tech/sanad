import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '@/components/ui';

/** Three tabs, because the student's day has three modes: courses, uploads, plan. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.ink,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.line },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.inkFaint,
        sceneStyle: { backgroundColor: theme.ground },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Courses',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▣</Text>,
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: 'Recordings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>↑</Text>,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◷</Text>,
        }}
      />
    </Tabs>
  );
}
