/**
 * Home — answers "Where am I supposed to be right now?"
 * One quiet card: status, course, detail rows, countdown, leave-by line,
 * attendance importance, actions. Color only where it means something.
 */

import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Linking, Platform, ScrollView, Text, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorBox,
  Field,
  FONT,
  Icon,
  IconRow,
  Loading,
  Row,
  Screen,
  TextLink,
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
import { MEETING_COMPONENT_LABEL, WALK_START_POINT_LABEL } from '@/lib/types';
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
  const todayLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text
          style={{
            fontFamily: FONT.regular,
            fontSize: 13,
            color: c.textSecondary,
            marginBottom: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}>
          {todayLabel}
        </Text>
        {error ? <ErrorBox message={error} /> : null}

        {!data.hasCourses ? (
          <>
            <EmptyState
              icon="school-outline"
              title="No classes yet"
              hint="Import your schedule from an .ics or CSV file, paste text copied from a schedule screenshot, or add classes manually."
            />
            <Button label="Import schedule" icon="download-outline" onPress={() => router.push('/import')} />
            <Button
              label="Add a class manually"
              kind="secondary"
              icon="add"
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
              icon="cafe-outline"
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
            <Row style={{ gap: 10 }}>
              <Icon name="arrow-forward-circle-outline" size={20} />
              <View style={{ flex: 1 }}>
                <Body secondary style={{ fontSize: 13 }}>
                  After this
                </Body>
                <Body>
                  {data.next.course.code} at {formatTime12(data.next.session.startTime)} ·{' '}
                  {[
                    data.next.session.overrideBuilding ?? data.next.session.building,
                    data.next.session.overrideRoom ?? data.next.session.room,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Body>
              </View>
            </Row>
          </Card>
        ) : null}

        {data.hasCourses ? (
          <Row style={{ marginTop: 4, justifyContent: 'center', gap: 24 }}>
            <TextLink label="Paste an email" icon="mail-outline" onPress={() => router.push('/email')} />
            <TextLink label="Import more" icon="download-outline" onPress={() => router.push('/import')} />
          </Row>
        ) : null}

        <Text
          style={{
            color: c.textSecondary,
            fontSize: 12.5,
            fontFamily: FONT.regular,
            textAlign: 'center',
            marginTop: 18,
          }}>
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
  const leaveUrgent = !isCurrent && leave != null && msUntilLeave <= 0;

  const openDirections = () => {
    Linking.openURL(bestMapUrl(loc, building || course.code, Platform.OS === 'ios'));
  };

  const walkSourceNote =
    walk.source === 'override'
      ? 'your override'
      : walk.source === 'recorded'
        ? `avg of ${walk.sampleCount} timed walk${walk.sampleCount === 1 ? '' : 's'}`
        : walk.source === 'default'
          ? 'estimate'
          : 'by distance';

  return (
    <Card style={{ paddingVertical: 18 }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <Row style={{ gap: 8 }}>
          {isCurrent ? <LiveDot color={c.accent} /> : null}
          <Badge label={isCurrent ? 'In session' : 'Up next'} tone={isCurrent ? 'accent' : 'neutral'} />
          {session.status === 'moved' ? <Badge label="Moved" tone="warning" /> : null}
        </Row>
        <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary }}>
          {MEETING_COMPONENT_LABEL[session.patternLabel]}
        </Text>
      </Row>

      <Text style={{ fontFamily: FONT.black, fontSize: 24, color: c.text, letterSpacing: 0.2 }}>
        {course.code}
      </Text>
      <Body secondary style={{ marginBottom: 12 }}>
        {course.name}
      </Body>

      <IconRow icon="time-outline">
        {formatDateHuman(session.date)} · {formatTime12(session.startTime)}–{formatTime12(session.endTime)}
      </IconRow>
      <IconRow icon="location-outline">
        {building ? `${building} ${room}`.trim() : 'Location not set'}
        {loc?.entranceNotes ? (
          <Text style={{ color: c.textSecondary, fontSize: 13.5 }}>
            {'\n'}
            {loc.entranceNotes}
          </Text>
        ) : null}
      </IconRow>
      {course.professor ? <IconRow icon="person-outline">{course.professor}</IconRow> : null}
      {session.changeNote ? (
        <IconRow icon="information-circle-outline" color={c.warning}>
          {session.changeNote}
        </IconRow>
      ) : null}

      <Divider />

      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary, marginBottom: 2 }}>
            {isCurrent ? 'Status' : 'Starts in'}
          </Text>
          <Text
            style={{
              fontFamily: FONT.black,
              fontSize: 30,
              color: c.text,
              fontVariant: ['tabular-nums'],
              lineHeight: 34,
            }}>
            {isCurrent ? 'In progress' : formatCountdown(msUntilStart)}
          </Text>
        </View>
        {!isCurrent && leave ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary, marginBottom: 2 }}>
              {walk.minutes} min walk · {walkSourceNote}
            </Text>
            <Text
              style={{
                fontFamily: FONT.bold,
                fontSize: 16,
                color: leaveUrgent ? c.danger : c.text,
              }}>
              {leaveUrgent
                ? 'Leave now'
                : `Leave by ${leave.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
            </Text>
          </View>
        ) : null}
      </Row>

      {!isCurrent ? <WalkTimerWidget toBuilding={building} onSaved={onWalkTimed} /> : null}

      {importance ? (
        <>
          <Divider />
          <IconRow
            icon={
              importance.level === 'critical' || importance.level === 'high'
                ? 'flame-outline'
                : importance.level === 'unknown'
                  ? 'help-circle-outline'
                  : 'pulse-outline'
            }
            color={
              importance.level === 'critical'
                ? c.danger
                : importance.level === 'high'
                  ? c.warning
                  : undefined
            }>
            {IMPORTANCE_LABEL[importance.level]}
          </IconRow>
          {importance.reasons.slice(0, 3).map((r, i) => (
            <Body key={i} secondary style={{ fontSize: 13, marginLeft: 24, lineHeight: 19 }}>
              {r}
              {importance.citations[i]
                ? `  (${importance.citations[i].sourceFilename}${importance.citations[i].page ? `, p.${importance.citations[i].page}` : ''})`
                : ''}
            </Body>
          ))}
        </>
      ) : null}

      <Divider />

      <Row style={{ justifyContent: 'space-around', marginBottom: 6 }}>
        <TextLink label="Directions" icon="navigate-outline" onPress={openDirections} />
        <TextLink label="Notes" icon="create-outline" onPress={() => router.push(`/session/${session.id}`)} />
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Button label="Mark attended" icon="checkmark" onPress={onAttended} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Can't make it" kind="secondary" onPress={onAbsent} />
        </View>
      </Row>
    </Card>
  );
}

/** Small pulsing dot marking a class that's happening right now. */
function LiveDot({ color }: { color: string }) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return (
    <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity }} />
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
    return (
      <View style={{ alignItems: 'flex-end', marginTop: 2 }}>
        <TextLink label="Time this walk" icon="stopwatch-outline" onPress={() => setStage('picking')} />
      </View>
    );
  }

  if (stage === 'saved') {
    return (
      <Row style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Badge label={`Saved · ${Math.max(1, Math.round(elapsed / 60))} min`} tone="success" />
        <TextLink label="Done" onPress={reset} />
      </Row>
    );
  }

  if (stage === 'picking') {
    return (
      <View style={{ marginTop: 10 }}>
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
        <TextLink label="Cancel" onPress={reset} />
      </View>
    );
  }

  if (stage === 'ready' && from) {
    return (
      <View style={{ marginTop: 10 }}>
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
        <Button label="Start timer" icon="play" onPress={start} />
        <TextLink label="Back" onPress={() => setStage('picking')} />
      </View>
    );
  }

  // stage === 'running'
  return (
    <View style={{ marginTop: 10, alignItems: 'center' }}>
      <Text
        style={{
          fontSize: 32,
          fontFamily: FONT.black,
          color: c.text,
          fontVariant: ['tabular-nums'],
        }}>
        {formatElapsed(elapsed)}
      </Text>
      <Button label="Stop & save" icon="stop" onPress={stopAndSave} />
    </View>
  );
}
