/**
 * First-run welcome. On mobile Safari not yet installed, opens with the
 * Add to Home Screen tip (push reminders and the full-screen experience
 * both depend on that). On iPhone browsers other than Safari (Chrome,
 * Firefox, Edge — all WebKit under the hood, but none of them grant Web
 * Push the way Safari does), opens instead with a "switch to Safari" tip,
 * since showing Safari-specific Share instructions on a screen that
 * doesn't have that Share icon would just confuse them. Always ends with a
 * short walkthrough that sends the student to build their schedule or
 * browse the feature list. Shown once — any dismissal (X, Skip, or either
 * CTA) marks onboardingSeen so it never reappears.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';

import { shouldOfferAddToHomeScreen, shouldOfferSafariRedirect } from '../lib/browserEnv';
import { Body, Button, Card, FONT, Icon, IconRow, Row, useColors } from './ui';

type Step = 'safari-redirect' | 'a2hs' | 'welcome';

function detectInitialStep(): Step {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'welcome';
  const env = {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    platform: navigator.platform ?? '',
    isStandalone:
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) === true,
  };
  if (shouldOfferSafariRedirect(env)) return 'safari-redirect';
  if (shouldOfferAddToHomeScreen(env)) return 'a2hs';
  return 'welcome';
}

export function WelcomeModal({
  visible,
  onBuildSchedule,
  onSeeFeatures,
  onDismiss,
}: {
  visible: boolean;
  onBuildSchedule: () => void;
  onSeeFeatures: () => void;
  onDismiss: () => void;
}) {
  const c = useColors();
  const [step, setStep] = useState<Step>(detectInitialStep);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 }}>
        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip"
            onPress={onDismiss}
            hitSlop={8}
            style={({ pressed }) => ({
              position: 'absolute',
              right: 8,
              top: 8,
              padding: 8,
              opacity: pressed ? 0.5 : 1,
              zIndex: 1,
            })}>
            <Ionicons name="close" size={18} color={c.textSecondary} />
          </Pressable>

          {step === 'safari-redirect' ? (
            <>
              <Row style={{ gap: 8, marginBottom: 4, paddingRight: 24 }}>
                <Icon name="compass" size={20} color={c.accent} />
                <Body style={{ fontFamily: FONT.bold, fontSize: 17 }}>Open in Safari first</Body>
              </Row>
              <Body secondary style={{ fontSize: 13.5, lineHeight: 19, marginBottom: 10 }}>
                Class reminders on iPhone only work through{' '}
                <Body style={{ fontFamily: FONT.bold, fontSize: 13.5 }}>Safari</Body> — this browser
                can&apos;t grant them, even after adding the app to your Home Screen. Switch over
                first:
              </Body>
              <IconRow icon="copy-outline" iconColor={c.accent}>
                Copy this page&apos;s link (tap the address bar, then Copy)
              </IconRow>
              <IconRow icon="compass-outline" iconColor={c.accent}>
                Open the Safari app
              </IconRow>
              <IconRow icon="clipboard-outline" iconColor={c.accent}>
                Paste the link in and go
              </IconRow>
              <View style={{ height: 4 }} />
              <Button label="Got it" icon="checkmark" onPress={() => setStep('welcome')} />
            </>
          ) : step === 'a2hs' ? (
            <>
              <Row style={{ gap: 8, marginBottom: 4, paddingRight: 24 }}>
                <Icon name="share-outline" size={20} color={c.accent} />
                <Body style={{ fontFamily: FONT.bold, fontSize: 17 }}>Add to your Home Screen</Body>
              </Row>
              <Body secondary style={{ fontSize: 13.5, lineHeight: 19, marginBottom: 10 }}>
                For the smoothest experience — full-screen, faster, and able to send you class
                reminders — add ClassCompass to your Home Screen:
              </Body>
              <IconRow icon="share-outline" iconColor={c.accent}>
                Tap the <Body style={{ fontFamily: FONT.bold, fontSize: 13.5 }}>Share</Body> icon in
                Safari&apos;s toolbar
              </IconRow>
              <IconRow icon="add-outline" iconColor={c.accent}>
                Scroll down and tap{' '}
                <Body style={{ fontFamily: FONT.bold, fontSize: 13.5 }}>Add to Home Screen</Body>
              </IconRow>
              <IconRow icon="checkmark-circle-outline" iconColor={c.accent}>
                Tap <Body style={{ fontFamily: FONT.bold, fontSize: 13.5 }}>Add</Body> to confirm
              </IconRow>
              <View style={{ height: 4 }} />
              <Button label="Got it" icon="checkmark" onPress={() => setStep('welcome')} />
            </>
          ) : (
            <>
              <Row style={{ gap: 8, marginBottom: 4, paddingRight: 24 }}>
                <Icon name="compass" size={20} color={c.accent} />
                <Body style={{ fontFamily: FONT.bold, fontSize: 17 }}>Welcome to ClassCompass</Body>
              </Row>
              <Body secondary style={{ fontSize: 13.5, lineHeight: 19, marginBottom: 10 }}>
                Always know where you&apos;re supposed to be — and catch up fast if you miss a
                class.
              </Body>
              <IconRow icon="scan-outline" iconColor={c.accent}>
                Scan a Testudo screenshot to import every class in one tap
              </IconRow>
              <IconRow icon="notifications-outline" iconColor={c.accent}>
                Get a heads-up before class, and a &ldquo;leave now&rdquo; alert timed to your walk
              </IconRow>
              <IconRow icon="medkit-outline" iconColor={c.accent}>
                Miss one anyway? Build a catch-up plan straight from your syllabus
              </IconRow>
              <View style={{ height: 10 }} />
              <Button label="Build my schedule" icon="calendar-outline" onPress={onBuildSchedule} />
              <Button label="See all features" kind="secondary" onPress={onSeeFeatures} />
            </>
          )}
        </Card>
      </View>
    </Modal>
  );
}
