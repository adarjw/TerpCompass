import { Tabs } from 'expo-router';
import React from 'react';
import { Text, type ColorValue } from 'react-native';

import { Palette } from '@/components/ui';
import { useApp } from '@/state/AppContext';

function icon(glyph: string) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <Text style={{ fontSize: focused ? 22 : 20, color }} accessibilityElementsHidden>
        {glyph}
      </Text>
    );
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
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Now', tabBarIcon: icon('🧭') }} />
      <Tabs.Screen name="schedule" options={{ title: 'Schedule', tabBarIcon: icon('📅') }} />
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙️') }} />
    </Tabs>
  );
}
