import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '@/components/ui';

/**
 * Courses, recordings, plan, community, profile.
 *
 * Community is a preview and is labelled as one inside the screen — it is in
 * the tab bar because the roadmap is part of the product story, not because it
 * works.
 */
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
          title: 'Plan',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◷</Text>,
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◍</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◉</Text>,
        }}
      />
    </Tabs>
  );
}
