import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';

import { AppProvider, useApp } from '@/state/AppContext';

SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const { scheme, ready } = useApp();
  React.useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="course/[id]" options={{ title: 'Course' }} />
        <Stack.Screen name="course-edit" options={{ title: 'Edit course' }} />
        <Stack.Screen name="absence/[sessionId]" options={{ title: 'Record absence' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Class notes' }} />
        <Stack.Screen name="plan/[id]" options={{ title: 'Catch-up plan' }} />
        <Stack.Screen name="import" options={{ title: 'Import schedule' }} />
        <Stack.Screen name="buildings" options={{ title: 'Campus buildings' }} />
        <Stack.Screen name="email" options={{ title: 'Email / cancellation' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <ThemedStack />
    </AppProvider>
  );
}
