/** Settings: notifications, walking, appearance, AI opt-in, data controls. */

import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, Share, Switch, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  Row,
  Screen,
  Subtitle,
  useColors,
} from '@/components/ui';
import { wipeAllData } from '@/db/database';
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  locationsRepo,
  patternsRepo,
  plansRepo,
  resourcesRepo,
  sessionsRepo,
  tasksRepo,
} from '@/db/repo';
import { buildBackup } from '@/lib/backup';
import { normalizeTime } from '@/lib/csv';
import type { AppSettings } from '@/lib/types';
import { deleteAllSandboxFiles, writeExportFile } from '@/services/files';
import { useApp } from '@/state/AppContext';

export default function SettingsScreen() {
  const { ready } = useApp();
  // Settings load asynchronously; mounting the form (and its useState
  // initializers) before that resolves would permanently snapshot the
  // pre-load defaults instead of the persisted values. Gate on `ready`
  // (same signal Home uses) so the form only ever mounts once real data
  // is available.
  if (!ready) return <Loading />;
  return <SettingsForm />;
}

function SettingsForm() {
  const { db, settings, saveSettings, bump, rescheduleNotifications } = useApp();
  const c = useColors();
  const [error, setError] = useState<string | null>(null);
  const [walkSpeed, setWalkSpeed] = useState(String(settings.walkingSpeedMps));
  const [summaryTime, setSummaryTime] = useState(settings.notifications.morningSummaryTime);
  const [homeLat, setHomeLat] = useState(settings.homeLat?.toString() ?? '');
  const [homeLon, setHomeLon] = useState(settings.homeLon?.toString() ?? '');
  const [cliPath, setCliPath] = useState(settings.aiCliPath);
  const [studentName, setStudentName] = useState(settings.studentName);

  const update = async (patch: Partial<AppSettings>) => {
    try {
      await saveSettings({ ...settings, ...patch });
      await rescheduleNotifications();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const updateNotif = (key: keyof AppSettings['notifications'], value: boolean | string) =>
    update({ notifications: { ...settings.notifications, [key]: value } });

  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
      <Body style={{ flex: 1 }}>{label}</Body>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.accent }} />
    </Row>
  );

  const exportBackup = async () => {
    if (!db) return;
    try {
      const [courses, patterns, sessions, absences, resources, chunks, plans, tasks, locations] =
        await Promise.all([
          coursesRepo.all(db), patternsRepo.all(db), sessionsRepo.all(db), absencesRepo.all(db),
          resourcesRepo.all(db), chunksRepo.all(db), plansRepo.all(db),
          tasksRepo.all(db), locationsRepo.all(db),
        ]);
      const json = buildBackup({
        courses, patterns, sessions, absences, resources, chunks, plans, tasks, locations,
        settings: settings as unknown as Record<string, unknown>,
      });
      const uri = writeExportFile('terrapin-backup.json', json);
      await Share.share({ url: uri, message: json.length > 50000 ? 'Terrapin Class Compass backup' : json, title: 'terrapin-backup.json' });
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const deleteEverything = () => {
    Alert.alert(
      'Delete all local data?',
      'This removes every course, session, absence, plan, and uploaded file from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await wipeAllData();
              deleteAllSandboxFiles();
              await rescheduleNotifications();
              bump();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        {error ? <ErrorBox message={error} /> : null}

        <Subtitle>About you</Subtitle>
        <Card>
          <Field
            label="Your name (used to sign absence-notice email drafts)"
            value={studentName}
            onChangeText={setStudentName}
            onBlur={() => update({ studentName: studentName.trim() })}
            placeholder="Adar Weinman"
          />
        </Card>

        <Subtitle>Notifications (all local — no server)</Subtitle>
        <Card>
          {toggle('Morning schedule summary', settings.notifications.morningSummary, (v) => updateNotif('morningSummary', v))}
          <Field
            label="Morning summary time (HH:MM)"
            value={summaryTime}
            onChangeText={setSummaryTime}
            onBlur={() => {
              const t = normalizeTime(summaryTime);
              if (t) updateNotif('morningSummaryTime', t);
              else setSummaryTime(settings.notifications.morningSummaryTime);
            }}
            autoCapitalize="none"
          />
          {toggle('45 minutes before class', settings.notifications.before45, (v) => updateNotif('before45', v))}
          {toggle('20 minutes before class', settings.notifications.before20, (v) => updateNotif('before20', v))}
          {toggle('"Leave now" (walking-time aware)', settings.notifications.leaveNow, (v) => updateNotif('leaveNow', v))}
          {toggle('10-minute warning', settings.notifications.before10, (v) => updateNotif('before10', v))}
          {toggle('Catch-up plan reminders', settings.notifications.catchUpReminders, (v) => updateNotif('catchUpReminders', v))}
          <Button label="Re-schedule notifications now" kind="secondary" onPress={rescheduleNotifications} />
        </Card>

        <Subtitle>Walking estimates</Subtitle>
        <Card>
          <Body secondary style={{ marginBottom: 8 }}>
            Set your usual starting point (dorm/apartment) as coordinates — paste them from Google Maps
            (long-press your home → tap the numbers). Used only on-device.
          </Body>
          <Field label="Start latitude" value={homeLat} onChangeText={setHomeLat} keyboardType="numbers-and-punctuation" placeholder="38.9847" />
          <Field label="Start longitude" value={homeLon} onChangeText={setHomeLon} keyboardType="numbers-and-punctuation" placeholder="-76.9384" />
          <Field label="Walking speed (m/s, 1.35 ≈ average)" value={walkSpeed} onChangeText={setWalkSpeed} keyboardType="decimal-pad" />
          <Button
            label="Save walking settings"
            kind="secondary"
            onPress={() => {
              const lat = homeLat.trim() === '' ? null : Number(homeLat);
              const lon = homeLon.trim() === '' ? null : Number(homeLon);
              const speed = Number(walkSpeed);
              if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
                setError('Latitude/longitude must be numbers like 38.9847 and -76.9384.');
                return;
              }
              if (!Number.isFinite(speed) || speed <= 0 || speed > 4) {
                setError('Walking speed should be between 0.5 and 4 m/s.');
                return;
              }
              update({ homeLat: lat, homeLon: lon, walkingSpeedMps: speed });
            }}
          />
          <Button label="Edit campus buildings" kind="ghost" onPress={() => router.push('/buildings')} />
        </Card>

        <Subtitle>Appearance</Subtitle>
        <Card>
          <Row>
            {(['system', 'light', 'dark'] as const).map((mode) => (
              <View key={mode} style={{ flex: 1 }}>
                <Button
                  label={mode}
                  kind={settings.darkMode === mode ? 'primary' : 'secondary'}
                  compact
                  onPress={() => update({ darkMode: mode })}
                />
              </View>
            ))}
          </Row>
        </Card>

        <Subtitle>AI assistance (optional, off by default)</Subtitle>
        <Card>
          <Body secondary style={{ marginBottom: 8 }}>
            Catch-up plans always work without AI using the built-in on-device analyzer.
            Enabling a CLI provider sends the selected course materials to that local command —
            nothing is ever uploaded by the app itself. Note: running a CLI requires the app to be
            running on a computer (Expo web/dev); on a phone this stays unavailable and the
            built-in analyzer is used.
          </Body>
          {toggle('Enable CLI provider (opt-in)', settings.aiCliEnabled, (v) => update({ aiCliEnabled: v }))}
          {settings.aiCliEnabled ? (
            <>
              <Row style={{ marginBottom: 8 }}>
                {(['claude-cli', 'other-cli'] as const).map((id) => (
                  <View key={id} style={{ flex: 1 }}>
                    <Button
                      label={id === 'claude-cli' ? 'Claude CLI' : 'Custom CLI'}
                      kind={settings.aiProviderId === id ? 'primary' : 'secondary'}
                      compact
                      onPress={() => update({ aiProviderId: id })}
                    />
                  </View>
                ))}
              </Row>
              <Field
                label="Command path (e.g. claude)"
                value={cliPath}
                onChangeText={setCliPath}
                onBlur={() => update({ aiCliPath: cliPath.trim() })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          ) : null}
        </Card>

        <Subtitle>Your data</Subtitle>
        <Card>
          <Body secondary style={{ marginBottom: 8 }}>
            Everything lives in a local database and local files on this device. Uploaded course
            files never leave the device unless you enable a provider above.
          </Body>
          <Button label="Export JSON backup" kind="secondary" onPress={exportBackup} />
          <Button label="Restore from backup (Import screen)" kind="secondary" onPress={() => router.push('/import')} />
          <Button label="Delete all local data" kind="danger" onPress={deleteEverything} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
