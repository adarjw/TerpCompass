/**
 * Feature directory: a concise, tappable list of everything the app does.
 * Each row expands into a short plain-language description of the feature
 * and where to find it.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, FONT, Icon, Screen, useColors, type IconName } from '@/components/ui';

interface Feature {
  name: string;
  icon: IconName;
  description: string;
}

const FEATURES: Feature[] = [
  {
    name: 'Screenshot import',
    icon: 'scan-outline',
    description:
      'Scan a Testudo schedule screenshot and every course imports in one tap — read entirely on your device, nothing uploaded. Import tab → "Scan a schedule screenshot".',
  },
  {
    name: 'Where should I be?',
    icon: 'compass-outline',
    description:
      'The Now tab always shows your current or next class: location, when to leave based on walking time, and one-tap directions.',
  },
  {
    name: 'Leave-now reminders',
    icon: 'notifications-outline',
    description:
      'Local notifications before each class — morning summary, 45/20/10-minute warnings, and a "leave now" alert timed to your walk. Configure in Settings. No account or server involved.',
  },
  {
    name: 'Walk timer',
    icon: 'stopwatch-outline',
    description:
      'Time a real walk to class ("Time route" on the Now card). Your recorded times replace the rough distance estimate for that route.',
  },
  {
    name: 'Class notes',
    icon: 'create-outline',
    description:
      'Tap any class to jot timestamped notes during the period — a running timeline of what happened. Also reachable from the Now card.',
  },
  {
    name: 'Absences & catch-up plans',
    icon: 'medkit-outline',
    description:
      'Mark a class missed and the app builds a catch-up plan from your uploaded syllabus/slides: likely topic, readings with page numbers, problems, a minimum-viable version, and a self-check quiz. It never invents content — if it can\'t tell what you missed, it says so.',
  },
  {
    name: 'Skip-worthiness meter',
    icon: 'flame-outline',
    description:
      'Each class shows how important attendance is that day, based on your syllabus (exams, quizzes, due dates) and the course attendance policy — with sources cited.',
  },
  {
    name: 'PlanetTerp info',
    icon: 'school-outline',
    description:
      'Pull real course titles, average GPA, professor ratings, and what student reviews say about attendance — free, no account. On each course page, or automatically during screenshot import.',
  },
  {
    name: 'Absence email drafts',
    icon: 'mail-outline',
    description:
      'After marking an absence, generate a ready-to-send email to your professor for five common reasons (sickness, appointment, travel…). Opens in your mail app — you review and hit send.',
  },
  {
    name: 'Cancellation detector',
    icon: 'mail-unread-outline',
    description:
      'Paste a professor\'s email (or import a .eml file) and the app detects cancellations, room changes, and remote days — always confirming with you before touching the schedule.',
  },
  {
    name: 'Campus buildings',
    icon: 'business-outline',
    description:
      'An editable UMD building list with entrance notes and walking-time overrides. Every location in the app deep-links to Apple or Google Maps.',
  },
  {
    name: 'Backup & privacy',
    icon: 'shield-checkmark-outline',
    description:
      'Everything lives on your device — no account, no cloud. Export/restore a JSON backup, or wipe all data, from Settings.',
  },
];

export default function FeaturesScreen() {
  const c = useColors();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {FEATURES.map((f) => {
          const expanded = open === f.name;
          return (
            <View
              key={f.name}
              style={{
                backgroundColor: c.card,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                borderRadius: 8,
                marginBottom: 8,
                overflow: 'hidden',
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(expanded ? null : f.name)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  backgroundColor: pressed ? c.subtle : 'transparent',
                })}>
                <Icon name={f.icon} size={19} color={c.accent} />
                <Text style={{ flex: 1, fontFamily: FONT.bold, fontSize: 15, color: c.text }}>{f.name}</Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.textSecondary} />
              </Pressable>
              {expanded ? (
                <Body secondary style={{ fontSize: 14, paddingHorizontal: 14, paddingBottom: 13, lineHeight: 20 }}>
                  {f.description}
                </Body>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
