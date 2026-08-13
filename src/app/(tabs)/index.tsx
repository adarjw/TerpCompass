/**
 * Home — answers "Where am I supposed to be right now?"
 * Current/next class, countdown, leave-now time, walking estimate,
 * attendance importance, and one-tap attended/absence actions.
 */

import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Row,
  Screen,
  Subtitle,
  Title,
  useColors,
} from '@/components/ui';
import {
  chunksRepo,
  coursesRepo,
  locationsRepo,
  sessionsRepo,
  walkRecordingsRepo,
} from '@/db/repo';
import { loadDemoData } from '@/db/seed';
import { findBuilding } from '@/lib/campus';
import { makeId } from '@/lib/ids';
import { IMPORTANCE_LABEL, scoreSessionImportance } from '@/lib/importance';
import { whereShouldIBe, sessionEnd, sessionStart, type SessionWithCourse } from '@/lib/sessions';
import { formatCountdown, formatDateHuman, formatTime12 } from '@/lib/time';
import type { CampusLocation, SessionImportance, WalkRecording, WalkStartPoint } from '@/lib/types';
import { WALK_START_POINT_LABEL } from '@/lib/types';
import { bestMapUrl, estimateWalkWithRecordings, leaveAt, type WalkEstimate } from '@/lib/walking';
import { useApp } from '@/state/AppContext';

interface HomeData {
  current: SessionWithCourse | null;
  next: SessionWithCourse | null;
  todayCount: number;
  buildings: CampusLocation[];
  importanceBySession: Record<string, SessionImportance>;
  hasCourses: boolean;
  walkRecordings: WalkRecording[];
  /** Best guess at where the user is walking from, for the "next" session. */
  impliedFromLabel: 'previous_class' | 'dorm';
}

const WALK_START_OPTIONS: WalkStartPoint[] = [
  'previous_class',
  'dining_south',
  'yahentamitsi',
  '251_north',
  'dorm',
  'other',
];

export default function HomeScreen() {
  const { db, ready, initError, settings, version, bump, rescheduleNotifications } = useApp();
  const c = useColors();
  const [data, setData] = useState<HomeData | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState<string | null>(null);

  // Tick the countdown every 30 seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!db) return;
    try {
      const [courses, sessions, buildings, walkRecordings] = await Promise.all([
        coursesRepo.all(db),
        sessionsRepo.all(db),
        locationsRepo.all(db),
        walkRecordingsRepo.all(db),
      ]);
      const byId = new Map(courses.map((co) => [co.id, co]));
      const nowDate = new Date();
      const info = whereShouldIBe(sessions, byId, nowDate);
      const importanceBySession: Record<string, SessionImportance> = {};
      for (const sc of [info.current, info.next]) {
        if (!sc) continue;
        const chunks = await chunksRepo.forCourse(db, sc.course.id);
        importanceBySession[sc.session.id] = scoreSessionImportance(
          sc.course,
          sc.session.date,
          chunks,
        );
      }
      // Guess whether the user is coming from another class today (common
      // back-to-back case) or from home/dorm (first class of the day) —
      // used to pick which recorded-walk average applies automatically.
      let impliedFromLabel: 'previous_class' | 'dorm' = 'dorm';
      if (info.next) {
        const nextStart = sessionStart(info.next.session);
        if (nextStart) {
          const hasPriorToday = sessions.some((s) => {
            if (s.id === info.next!.session.id || s.date !== info.next!.session.date) return false;
            if (s.status === 'canceled') return false;
            const end = sessionEnd(s);
            if (!end) return false;
            const gapMin = (nextStart.getTime() - end.getTime()) / 60000;
            return gapMin >= 0 && gapMin <= 30;
          });
          if (hasPriorToday) impliedFromLabel = 'previous_class';
        }
      }
      setData({
        current: info.current,
        next: info.next,
        todayCount: info.todayRemaining.length,
        walkRecordings,
        impliedFromLabel,
        buildings,
        importanceBySession,
        hasCourses: courses.length > 0,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [load, version]),
  );

  if (initError) {
    return (
      <Screen>
        <ErrorBox message={`The app storage failed to open: ${initError}`} />
      </Screen>
    );
  }
  if (!ready || !data) return <Loading label="Opening your schedule…" />;

  const markAttended = async (sc: SessionWithCourse) => {
    if (!db) return;
    await sessionsRepo.setStatus(db, sc.session.id, 'attended');
    bump();
  };

  const focus = data.current ?? data.next;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {error ? <ErrorBox message={error} /> : null}

        {!data.hasCourses ? (
          <>
            <EmptyState
              title="No classes yet"
              hint="Import your schedule from an .ics or CSV file, paste text copied from a schedule screenshot, or add classes manually. You can also load demo UMD classes to explore the app."
            />
            <Button label="Import schedule" onPress={() => router.push('/import')} />
            <Button
              label="Add a class manually"
              kind="secondary"
              onPress={() => router.push('/course-edit')}
            />
            <Button
              label="Load demo data (UMD sample)"
              kind="ghost"
              onPress={async () => {
                if (!db) return;
                await loadDemoData(db, new Date());
                bump();
                await rescheduleNotifications();
              }}
            />
          </>
        ) : !focus ? (
          <>
            <EmptyState
              title="Nothing on the schedule"
              hint="No upcoming classes found. Enjoy the break — or check the Schedule tab to make sure your semester dates are right."
            />
            <Button label="View schedule" kind="secondary" onPress={() => router.push('/schedule')} />
          </>
        ) : (
          <FocusCard
            sc={focus}
            isCurrent={focus === data.current}
            now={now}
            buildings={data.buildings}
            importance={data.importanceBySession[focus.session.id]}
            settings={settings}
            walkRecordings={data.walkRecordings}
            impliedFromLabel={data.impliedFromLabel}
            onAttended={() => markAttended(focus)}
            onAbsent={() => router.push(`/absence/${focus.session.id}`)}
            onWalkTimed={bump}
          />
        )}

        {data.current && data.next ? (
          <Card>
            <Subtitle>After this</Subtitle>
            <Body>
              {data.next.course.code} at {formatTime12(data.next.session.startTime)} —{' '}
              {[data.next.session.overrideBuilding ?? data.next.session.building, data.next.session.overrideRoom ?? data.next.session.room]
                .filter(Boolean)
                .join(' ')}
            </Body>
          </Card>
        ) : null}

        {data.hasCourses ? (
          <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 150 }}>
              <Button label="Paste an email" kind="secondary" onPress={() => router.push('/email')} />
            </View>
            <View style={{ flex: 1, minWidth: 150 }}>
              <Button label="Import more" kind="secondary" onPress={() => router.push('/import')} />
            </View>
          </Row>
        ) : null}

        <Text style={{ color: c.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
          {data.todayCount > 0
            ? `${data.todayCount} class${data.todayCount === 1 ? '' : 'es'} left today`
            : 'No more classes today'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function FocusCard({
  sc,
  isCurrent,
  now,
  buildings,
  importance,
  settings,
  walkRecordings,
  impliedFromLabel,
  onAttended,
  onAbsent,
  onWalkTimed,
}: {
  sc: SessionWithCourse;
  isCurrent: boolean;
  now: Date;
  buildings: CampusLocation[];
  importance?: SessionImportance;
  settings: ReturnType<typeof useApp>['settings'];
  walkRecordings: WalkRecording[];
  impliedFromLabel: 'previous_class' | 'dorm';
  onAttended: () => void;
  onAbsent: () => void;
  onWalkTimed: () => void;
}) {
  const c = useColors();
  const { session, course } = sc;
  const building = session.overrideBuilding ?? session.building;
  const room = session.overrideRoom ?? session.room;
  const loc = findBuilding(buildings, building);
  const walk: WalkEstimate = estimateWalkWithRecordings(
    walkRecordings,
    impliedFromLabel,
    building,
    { lat: settings.homeLat, lon: settings.homeLon },
    loc,
    settings.walkingSpeedMps,
  );
  const start = sessionStart(session);
  const leave = start ? leaveAt(start, walk, course) : null;
  const msUntilStart = start ? start.getTime() - now.getTime() : 0;
  const msUntilLeave = leave ? leave.getTime() - now.getTime() : 0;

  const openDirections = () => {
    Linking.openURL(bestMapUrl(loc, building || course.code, Platform.OS === 'ios'));
  };

  const importanceTone =
    importance?.level === 'critical'
      ? 'danger'
      : importance?.level === 'high'
        ? 'warning'
        : importance?.level === 'unknown'
          ? 'neutral'
          : 'success';

  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: course.color ?? c.accent }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Badge label={isCurrent ? 'HAPPENING NOW' : 'NEXT CLASS'} tone={isCurrent ? 'danger' : 'accent'} />
        {session.status === 'moved' ? <Badge label="MOVED" tone="warning" /> : null}
      </Row>
      <Title>
        {course.code} · {course.name}
      </Title>
      <Body secondary>
        {formatDateHuman(session.date)} · {formatTime12(session.startTime)}–{formatTime12(session.endTime)}
        {course.professor ? ` · ${course.professor}` : ''}
      </Body>
      <View style={{ marginVertical: 10 }}>
        <Text style={{ fontSize: 34, fontWeight: '800', color: c.text }}>
          {isCurrent ? 'In progress' : `in ${formatCountdown(msUntilStart)}`}
        </Text>
        <Body>
          📍 {building || 'Building not set'} {room}
          {loc?.entranceNotes ? `\n➤ ${loc.entranceNotes}` : ''}
        </Body>
        {session.changeNote ? <Body secondary>Note: {session.changeNote}</Body> : null}
      </View>

      {!isCurrent && leave ? (
        <View
          style={{
            backgroundColor: msUntilLeave <= 0 ? c.danger + '18' : c.subtle,
            borderRadius: 10,
            padding: 10,
            marginBottom: 10,
          }}>
          <Body>
            🚶 ~{walk.minutes} min walk
            {walk.source === 'override'
              ? ' (your override)'
              : walk.source === 'recorded'
                ? ` (from ${walk.sampleCount} timed walk${walk.sampleCount === 1 ? '' : 's'})`
                : walk.source === 'default'
                  ? ' (rough default — set your start point in Settings)'
                  : ''}
          </Body>
          <Text style={{ fontSize: 18, fontWeight: '700', color: msUntilLeave <= 0 ? c.danger : c.text }}>
            {msUntilLeave <= 0
              ? 'Leave now!'
              : `Leave by ${leave.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (${formatCountdown(msUntilLeave)})`}
          </Text>
          <WalkTimerWidget toBuilding={building} onSaved={onWalkTimed} />
        </View>
      ) : null}

      {importance ? (
        <View style={{ marginBottom: 10 }}>
          <Row>
            <Badge label={IMPORTANCE_LABEL[importance.level]} tone={importanceTone} />
          </Row>
          {importance.reasons.slice(0, 3).map((r, i) => (
            <Body key={i} secondary style={{ fontSize: 13 }}>
              • {r}
              {importance.citations[i]
                ? `  (${importance.citations[i].sourceFilename}${importance.citations[i].page ? `, p.${importance.citations[i].page}` : ''})`
                : ''}
            </Body>
          ))}
        </View>
      ) : null}

      <Row>
        <View style={{ flex: 1 }}>
          <Button label="Directions" kind="secondary" onPress={openDirections} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Notes" kind="secondary" onPress={() => router.push(`/session/${session.id}`)} />
        </View>
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Button label="✓ Attended" onPress={onAttended} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Can't make it" kind="ghost" onPress={onAbsent} />
        </View>
      </Row>
    </Card>
  );
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Times an actual walk and saves it as a WalkRecording for this route, so
 * future estimates for the same starting point → building can use a real
 * average instead of a straight-line guess. Nothing here assumes GPS —
 * it's a plain stopwatch the user starts and stops themselves.
 */
function WalkTimerWidget({ toBuilding, onSaved }: { toBuilding: string; onSaved: () => void }) {
  const { db } = useApp();
  const c = useColors();
  const [stage, setStage] = useState<'closed' | 'picking' | 'ready' | 'running' | 'saved'>('closed');
  const [from, setFrom] = useState<WalkStartPoint | null>(null);
  const [otherText, setOtherText] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stage !== 'running' || startedAt == null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [stage, startedAt]);

  const reset = () => {
    setStage('closed');
    setFrom(null);
    setOtherText('');
    setStartedAt(null);
    setElapsed(0);
  };

  const start = () => {
    setStartedAt(Date.now());
    setElapsed(0);
    setStage('running');
  };

  const stopAndSave = async () => {
    if (!db || !from) return;
    const minutes = Math.max(1, Math.round(elapsed / 60));
    await walkRecordingsRepo.insert(db, {
      id: makeId(),
      fromLabel: from,
      fromOtherText: from === 'other' ? otherText.trim() || undefined : undefined,
      toBuilding,
      minutes,
      recordedAt: new Date().toISOString(),
    });
    setStage('saved');
    onSaved();
  };

  if (stage === 'closed') {
    return <Button label="⏱ Time this walk" kind="ghost" compact onPress={() => setStage('picking')} />;
  }

  if (stage === 'saved') {
    return (
      <View>
        <Badge label={`Saved: ${Math.max(1, Math.round(elapsed / 60))} min`} tone="success" />
        <Button label="Done" kind="ghost" compact onPress={reset} />
      </View>
    );
  }

  if (stage === 'picking') {
    return (
      <View style={{ marginTop: 8 }}>
        <Body secondary style={{ fontSize: 13, marginBottom: 6 }}>
          Where are you walking from?
        </Body>
        <Row style={{ flexWrap: 'wrap' }}>
          {WALK_START_OPTIONS.map((opt) => (
            <View key={opt} style={{ minWidth: 130, flex: 1 }}>
              <Button
                label={WALK_START_POINT_LABEL[opt]}
                compact
                kind="secondary"
                onPress={() => {
                  setFrom(opt);
                  setStage('ready');
                }}
              />
            </View>
          ))}
        </Row>
        <Button label="Cancel" kind="ghost" compact onPress={reset} />
      </View>
    );
  }

  if (stage === 'ready' && from) {
    return (
      <View style={{ marginTop: 8 }}>
        {from === 'other' ? (
          <Field
            label="Describe this location"
            value={otherText}
            onChangeText={setOtherText}
            placeholder="e.g. the library"
          />
        ) : (
          <Body secondary style={{ fontSize: 13, marginBottom: 6 }}>
            Starting from: {WALK_START_POINT_LABEL[from]}
          </Body>
        )}
        <Button label="Start timer" onPress={start} />
        <Button label="Back" kind="ghost" compact onPress={() => setStage('picking')} />
      </View>
    );
  }

  // stage === 'running'
  return (
    <View style={{ marginTop: 8, alignItems: 'center' }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: c.text }}>{formatElapsed(elapsed)}</Text>
      <Button label="Stop & save" onPress={stopAndSave} />
    </View>
  );
}
