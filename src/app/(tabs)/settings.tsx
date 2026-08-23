/** Settings: notifications, walking, appearance, AI opt-in, data controls. */

import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';

import { TimeField } from '@/components/TimeField';
import {
  AppSwitch,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  Row,
  Screen,
  SettingRow,
  SettingsGroup,
  Subtitle,
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
import { DEFAULT_SETTINGS, type AppSettings } from '@/lib/types';
import { matchWalkSpeedPreset, WALK_SPEED_PRESETS } from '@/lib/walking';
import { deleteAllSandboxFiles, writeExportFile } from '@/services/files';
import { disableWebPush, enableWebPush, isPushSupported } from '@/services/webpush';
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

/** The reminder toggles the master notification switch controls. */
const REMINDER_KEYS = [
  'morningSummary',
  'before45',
  'before20',
  'leaveNow',
  'before10',
  'catchUpReminders',
] as const;

function SettingsForm() {
  const { db, settings, saveSettings, bump, rescheduleNotifications } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [homeLat, setHomeLat] = useState(settings.homeLat?.toString() ?? '');
  const [homeLon, setHomeLon] = useState(settings.homeLon?.toString() ?? '');
  const [cliPath, setCliPath] = useState(settings.aiCliPath);
  const [studentName, setStudentName] = useState(settings.studentName);
  const [confirmWipe, setConfirmWipe] = useState(false);

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

  // There's no stored master flag: the master switch reads as "any reminder
  // on". Off turns every reminder off; on restores the defaults.
  const masterOn = REMINDER_KEYS.some((k) => settings.notifications[k]);
  const setMaster = (on: boolean) => {
    const next = { ...settings.notifications };
    for (const k of REMINDER_KEYS) next[k] = on ? DEFAULT_SETTINGS.notifications[k] : false;
    if (on && !REMINDER_KEYS.some((k) => next[k])) next.leaveNow = true;
    update({ notifications: next });
  };

  const [pushBusy, setPushBusy] = useState(false);
  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) {
        const result = await enableWebPush();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await update({ webPushEnabled: true }); // update() also syncs the relay
      } else {
        await disableWebPush();
        await update({ webPushEnabled: false });
      }
      setError(null);
    } finally {
      setPushBusy(false);
    }
  };

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
      const uri = writeExportFile('classcompass-backup.json', json);
      await Share.share({ url: uri, message: json.length > 50000 ? 'ClassCompass backup' : json, title: 'classcompass-backup.json' });
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const deleteEverything = async () => {
    try {
      await wipeAllData();
      deleteAllSandboxFiles();
      setConfirmWipe(false);
      await rescheduleNotifications();
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {error ? <ErrorBox message={error} /> : null}

        <Subtitle>About you</Subtitle>
        <SettingsGroup>
          <SettingRow label="Name" helper="Used in absence-email drafts">
            <Field
              value={studentName}
              onChangeText={setStudentName}
              onBlur={() => update({ studentName: studentName.trim() })}
              placeholder="Your name"
              style={{ marginTop: 8 }}
            />
          </SettingRow>
        </SettingsGroup>

        <Subtitle>Notifications</Subtitle>
        <SettingsGroup>
          <SettingRow
            label="Notifications"
            helper="Stored and scheduled on this device"
            right={<AppSwitch value={masterOn} onValueChange={setMaster} />}
          />
          {Platform.OS === 'web' ? (
            <SettingRow
              label="Push notifications"
              helper={
                isPushSupported()
                  ? 'Reminders arrive even while the app is closed. Only your pending reminders are kept on the relay — each is deleted as soon as it’s sent, and everything is deleted if you turn this off.'
                  : 'Not available in this browser. On iPhone, add the app to your home screen first, then enable this inside the installed app.'
              }
              right={
                <AppSwitch
                  value={settings.webPushEnabled}
                  onValueChange={togglePush}
                  disabled={pushBusy || !isPushSupported()}
                />
              }
            />
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="Morning summary"
              right={
                <AppSwitch
                  value={settings.notifications.morningSummary}
                  onValueChange={(v) => updateNotif('morningSummary', v)}
                />
              }>
              {settings.notifications.morningSummary ? (
                <View style={{ marginTop: 8 }}>
                  <TimeField
                    value={settings.notifications.morningSummaryTime}
                    onChange={(t) => updateNotif('morningSummaryTime', t)}
                  />
                </View>
              ) : null}
            </SettingRow>
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="45 minutes before"
              right={<AppSwitch value={settings.notifications.before45} onValueChange={(v) => updateNotif('before45', v)} />}
            />
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="20 minutes before"
              right={<AppSwitch value={settings.notifications.before20} onValueChange={(v) => updateNotif('before20', v)} />}
            />
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="Leave now"
              helper="Timed to your walk"
              right={<AppSwitch value={settings.notifications.leaveNow} onValueChange={(v) => updateNotif('leaveNow', v)} />}
            />
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="10-minute warning"
              right={<AppSwitch value={settings.notifications.before10} onValueChange={(v) => updateNotif('before10', v)} />}
            />
          ) : null}
          {masterOn ? (
            <SettingRow
              indent
              label="Catch-up reminders"
              right={
                <AppSwitch
                  value={settings.notifications.catchUpReminders}
                  onValueChange={(v) => updateNotif('catchUpReminders', v)}
                />
              }
            />
          ) : null}
        </SettingsGroup>
        {masterOn ? (
          <Button label="Reschedule notifications" kind="secondary" compact onPress={rescheduleNotifications} />
        ) : null}

        <Subtitle>Walking estimates</Subtitle>
        <SettingsGroup>
          <SettingRow
            label="Starting point"
            helper="Your dorm/apartment as coordinates — paste them from Google Maps (long-press home → tap the numbers). Used only on-device.">
            <View style={{ marginTop: 10 }}>
              <Field label="Latitude" value={homeLat} onChangeText={setHomeLat} keyboardType="numbers-and-punctuation" placeholder="38.9847" />
              <Field label="Longitude" value={homeLon} onChangeText={setHomeLon} keyboardType="numbers-and-punctuation" placeholder="-76.9384" />
              <Button
                label="Save starting point"
                kind="secondary"
                compact
                onPress={() => {
                  const lat = homeLat.trim() === '' ? null : Number(homeLat);
                  const lon = homeLon.trim() === '' ? null : Number(homeLon);
                  if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) {
                    setError('Latitude/longitude must be numbers like 38.9847 and -76.9384.');
                    return;
                  }
                  update({ homeLat: lat, homeLon: lon });
                }}
              />
            </View>
          </SettingRow>
          <SettingRow label="Walking pace" helper="Used to estimate walk times and when to leave">
            <Row style={{ marginTop: 8 }}>
              {WALK_SPEED_PRESETS.map((preset) => (
                <View key={preset.id} style={{ flex: 1 }}>
                  <Button
                    label={preset.label}
                    kind={matchWalkSpeedPreset(settings.walkingSpeedMps) === preset.id ? 'primary' : 'secondary'}
                    compact
                    onPress={() => update({ walkingSpeedMps: preset.mps })}
                  />
                </View>
              ))}
            </Row>
          </SettingRow>
          <SettingRow label="Campus buildings" helper="Entrances and walking-time overrides" onPress={() => router.push('/buildings')} right={<Body secondary>›</Body>} />
        </SettingsGroup>

        <Subtitle>Appearance</Subtitle>
        <SettingsGroup>
          <SettingRow label="Theme">
            <Row style={{ marginTop: 8 }}>
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
          </SettingRow>
        </SettingsGroup>

        <Subtitle>AI assistance</Subtitle>
        <SettingsGroup>
          <SettingRow
            label="CLI provider"
            helper="Off by default. Catch-up plans always work without AI using the built-in on-device analyzer. Enabling sends selected course materials to a local command — nothing is uploaded by the app itself. Requires running on a computer."
            right={<AppSwitch value={settings.aiCliEnabled} onValueChange={(v) => update({ aiCliEnabled: v })} />}
          />
          {settings.aiCliEnabled ? (
            <SettingRow indent label="Provider">
              <View style={{ marginTop: 8 }}>
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
              </View>
            </SettingRow>
          ) : null}
        </SettingsGroup>

        <Subtitle>Your data</Subtitle>
        <SettingsGroup>
          <SettingRow
            label="Export JSON backup"
            helper="Everything lives on this device; uploaded files never leave it unless you enable a provider above."
            onPress={exportBackup}
            right={<Body secondary>›</Body>}
          />
          <SettingRow label="Restore from backup" onPress={() => router.push('/import')} right={<Body secondary>›</Body>} />
        </SettingsGroup>
        {!confirmWipe ? (
          <Button label="Delete all local data" kind="danger-outline" compact onPress={() => setConfirmWipe(true)} />
        ) : (
          <Card>
            <Body style={{ marginBottom: 8 }}>
              Delete every course, session, absence, plan, setting, and uploaded file from this
              device? This cannot be undone.
            </Body>
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Delete everything" kind="danger" onPress={deleteEverything} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" kind="secondary" onPress={() => setConfirmWipe(false)} />
              </View>
            </Row>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
