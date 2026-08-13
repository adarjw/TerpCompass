import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, type ColorValue } from 'react-native';

import { FONT, Palette } from '@/components/ui';
import { useApp } from '@/state/AppContext';

function icon(active: keyof typeof Ionicons.glyphMap, inactive: keyof typeof Ionicons.glyphMap) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={22} color={color as string} />;
  }
  return TabIcon;
}

/**
 * On web, safe-area-context can't measure the iPhone home indicator, so the
 * bar gets an explicit height that includes env(safe-area-inset-bottom)
 * (exposed by viewport-fit=cover in the HTML shell). RN-web passes these
 * CSS strings through; the casts are for RN's number-typed style props.
 * Native platforms keep react-navigation's own safe-area handling.
 */
const webTabBarSizing =
  Platform.OS === 'web'
    ? {
        height: 'calc(60px + env(safe-area-inset-bottom, 0px))' as unknown as number,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)' as unknown as number,
        paddingTop: 6,
      }
    : {};

export default function TabsLayout() {
  const { scheme } = useApp();
  const c = Palette[scheme];
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border, ...webTabBarSizing },
        tabBarLabelStyle: { fontFamily: FONT.bold, fontSize: 11 },
        headerStyle: { backgroundColor: c.card },
        headerShadowVisible: false,
        headerTitleStyle: { color: c.text, fontFamily: FONT.bold, fontSize: 17 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Now', tabBarIcon: icon('compass', 'compass-outline') }} />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          // The schedule screen draws its own compact app bar with week
          // navigation, replacing the default (taller) navigator header.
          headerShown: false,
          tabBarIcon: icon('calendar', 'calendar-outline'),
        }}
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
