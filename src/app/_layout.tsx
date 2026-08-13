import { Lato_400Regular, Lato_700Bold, Lato_900Black, useFonts } from '@expo-google-fonts/lato';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React from 'react';

import { FONT, Palette } from '@/components/ui';
import { AppProvider, useApp } from '@/state/AppContext';

SplashScreen.preventAutoHideAsync();

function ThemedStack({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { scheme, ready } = useApp();
  const c = Palette[scheme];

  React.useEffect(() => {
    if (ready && fontsLoaded) SplashScreen.hideAsync();
  }, [ready, fontsLoaded]);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.background,
      card: c.card,
      text: c.text,
      border: c.border,
    },
  };

  return (
    <ThemeProvider value={theme}>
      <Stack
        screenOptions={{
          headerTitleStyle: { fontFamily: FONT.bold, fontSize: 17 },
          headerBackTitleStyle: { fontFamily: FONT.regular },
          headerTintColor: c.accent,
          headerShadowVisible: false,
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="course/[id]" options={{ title: 'Course' }} />
        <Stack.Screen name="course-edit" options={{ title: 'Edit course' }} />
        <Stack.Screen name="absence/[sessionId]" options={{ title: 'Record absence' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Class notes' }} />
        <Stack.Screen name="plan/[id]" options={{ title: 'Catch-up plan' }} />
        <Stack.Screen name="import" options={{ title: 'Import schedule' }} />
        <Stack.Screen name="buildings" options={{ title: 'Campus buildings' }} />
        <Stack.Screen name="email" options={{ title: 'Email / cancellation' }} />
        <Stack.Screen name="features" options={{ title: 'What this app does' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Lato_400Regular,
    Lato_700Bold,
    Lato_900Black,
  });

  return (
    <AppProvider>
      <ThemedStack fontsLoaded={fontsLoaded} />
    </AppProvider>
  );
}
