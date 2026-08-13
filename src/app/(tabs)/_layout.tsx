import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';

import { FONT, Palette } from '@/components/ui';
import { useApp } from '@/state/AppContext';

function icon(active: keyof typeof Ionicons.glyphMap, inactive: keyof typeof Ionicons.glyphMap) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={22} color={color as string} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const { scheme } = useApp();
  const c = Palette[scheme];
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        tabBarLabelStyle: { fontFamily: FONT.bold, fontSize: 11 },
        headerStyle: { backgroundColor: c.card },
        headerShadowVisible: false,
        headerTitleStyle: { color: c.text, fontFamily: FONT.bold, fontSize: 17 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Now', tabBarIcon: icon('compass', 'compass-outline') }} />
      <Tabs.Screen
        name="schedule"
        options={{ title: 'Schedule', tabBarIcon: icon('calendar', 'calendar-outline') }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Dashboard', tabBarIcon: icon('stats-chart', 'stats-chart-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
