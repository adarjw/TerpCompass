/**
 * Home — answers "Where am I supposed to be right now?"
 * One quiet card: status, course, detail rows, countdown, leave-by line,
 * attendance importance, actions. Color only where it means something.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

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
import { WelcomeModal } from '@/components/WelcomeModal';
import {
  chunksRepo,
  coursesRepo,
  locationsRepo,
  resourcesRepo,
  sessionsRepo,
  walkRecordingsRepo,
} from '@/db/repo';
import { loadDemoData } from '@/db/seed';
import { findBuilding } from '@/lib/campus';
import { makeId } from '@/lib/ids';
import { IMPORTANCE_LABEL, scoreSessionImportance } from '@/lib/importance';
import { sessionEnd, sessionsOn, sessionStart, whereShouldIBe, type SessionWithCourse } from '@/lib/sessions';
import { formatCountdown, formatDateHuman, formatTime12, toISODate } from '@/lib/time';
import type { CampusLocation, SessionImportance, WalkRecording, WalkStartPoint } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WALK_START_POINT_LABEL } from '@/lib/types';
import { bestMapUrl, estimateWalkWithRecordings, leaveAt, type WalkEstimate } from '@/lib/walking';
import { useApp } from '@/state/AppContext';

interface HomeData {
  current: SessionWithCourse | null;
  next: SessionWithCourse | null;
  todayCount: number;
  /** Total classes scheduled today, remaining or not. */
  todayTotal: number;
  buildings: CampusLocation[];
  importanceBySession: Record<string, SessionImportance>;
  hasCourses: boolean;
  walkRecordings: WalkRecording[];
  /** Best guess at where the user is walking from, for the "next" session. */
  impliedFromLabel: 'previous_class' | 'dorm';
  /** Whether the focused session's course has a syllabus attached. */
  focusHasSyllabus: boolean;
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
  const { db, ready, initError, settings, version, bump, rescheduleNotifications, saveSettings } = useApp();
  const c = useColors();
  const params = useLocalSearchParams();
  const [data, setData] = useState<HomeData | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [countdownStartTime, setCountdownStartTime] = useState<Date | null>(() => {
    const startTimeStr = params.showCountdown;
    if (startTimeStr && typeof startTimeStr === 'string') {
      try {
        const startTime = new Date(decodeURIComponent(startTimeStr));
        if (!Number.isNaN(startTime.getTime())) return startTime;
      } catch {
        // Ignore invalid date strings
      }
    }
    return null;
  });
  // Hides the welcome modal the instant it's dismissed rather than waiting
  // on the settings save round-trip (which would otherwise let it flash
  // back into view during a route transition started by the same tap).
  const [welcomeDismissedLocally, setWelcomeDismissedLocally] = useState(false);

  // Tick the countdown every 30 seconds, or every 5 seconds if showing a countdown timer.
  useEffect(() => {
    const interval = countdownStartTime ? 5000 : 30000;
    const t = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(t);
  }, [countdownStartTime]);


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
      const focusSC = info.current ?? info.next;
      let focusHasSyllabus = false;
      if (focusSC) {
        const focusResources = await resourcesRepo.forCourse(db, focusSC.course.id);
        focusHasSyllabus = focusResources.some((r) => r.kind === 'syllabus');
      }
      setData({
        current: info.current,
        next: info.next,
        todayCount: info.todayRemaining.length,
        todayTotal: sessionsOn(sessions, toISODate(nowDate)).length,
        walkRecordings,
        impliedFromLabel,
        buildings,
        importanceBySession,
        hasCourses: courses.length > 0,
        focusHasSyllabus,
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

  // The local flag hides the modal instantly. The settings write is
  // *awaited* before either CTA navigates away: pushing a route can remount
  // this screen, and an in-flight (unawaited) write would lose the race,
  // letting a freshly-mounted instance read onboardingSeen as still false
  // and show the modal again right on top of the page just navigated to.
  const dismissWelcome = async () => {
    setWelcomeDismissedLocally(true);
    if (!settings.onboardingSeen) await saveSettings({ ...settings, onboardingSeen: true });
  };

  const showWelcome = ready && !welcomeDismissedLocally && !settings.onboardingSeen && !data.hasCourses;

  return (
    <Screen>
      {/* Unmounted rather than passed visible={false}: RN-web's Modal exit
          animation doesn't reliably tear down its portal in this app's
          setup, which left the overlay on screen after dismissal even
          though its own visible prop had already gone false. */}
      {showWelcome ? (
        <WelcomeModal
          visible
          onBuildSchedule={async () => {
            await dismissWelcome();
            router.push('/schedule');
          }}
          onSeeFeatures={async () => {
            await dismissWelcome();
            router.push('/features');
          }}
          onDismiss={dismissWelcome}
        />
      ) : null}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text
          style={{
            fontFamily: FONT.regular,
            fontSize: 13,
            color: c.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}>
          {todayLabel}
        </Text>
        {data.hasCourses ? (
          <Text style={{ fontFamily: FONT.regular, fontSize: 13.5, color: c.textSecondary, marginTop: 3, marginBottom: 10 }}>
            {data.todayCount > 0
              ? `${data.todayCount} class${data.todayCount === 1 ? '' : 'es'} left today`
              : data.todayTotal > 0
                ? 'No more classes today'
                : 'No classes today'}
          </Text>
        ) : (
          <View style={{ height: 10 }} />
        )}
        {error ? <ErrorBox message={error} /> : null}

        {countdownStartTime ? (
          <ClassCountdownCard
            startTime={countdownStartTime}
            now={now}
            onDismiss={() => setCountdownStartTime(null)}
          />
        ) : null}

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
            hasSyllabus={data.focusHasSyllabus}
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
          <Card style={{ paddingVertical: 4, paddingHorizontal: 4, flexDirection: 'row' }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/email')}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: pressed ? c.subtle : 'transparent',
              })}>
              <Icon name="mail-outline" size={16} color={c.accent} />
              <Text style={{ fontFamily: FONT.bold, fontSize: 13.5, color: c.text }}>Paste an email</Text>
            </Pressable>
            <View style={{ width: 1, backgroundColor: c.hairline, marginVertical: 6 }} />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/import')}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: pressed ? c.subtle : 'transparent',
              })}>
              <Icon name="download-outline" size={16} color={c.accent} />
              <Text style={{ fontFamily: FONT.bold, fontSize: 13.5, color: c.text }}>Import more</Text>
            </Pressable>
          </Card>
        ) : null}
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
  hasSyllabus,
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
  hasSyllabus: boolean;
  onAttended: () => void;
  onAbsent: () => void;
  onWalkTimed: () => void;
}) {
  const c = useColors();
  const [timerOpen, setTimerOpen] = useState(false);
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
  const minsUntilLeave = Math.ceil(msUntilLeave / 60000);
  const daysAway = Math.ceil(msUntilStart / 86400000);

  const openDirections = () => {
    Linking.openURL(bestMapUrl(loc, building || course.code, Platform.OS === 'ios'));
  };

  // Progressive urgency for the header's right side: far-off classes stay
  // quiet ("17 days away"), same-day emphasizes the leave time, and only
  // the truly urgent state gets the accent color.
  let urgency: { text: string; color: string; bold: boolean };
  if (isCurrent) {
    urgency = { text: `Ends ${formatTime12(session.endTime)}`, color: c.textSecondary, bold: false };
  } else if (msUntilStart > 24 * 3600 * 1000) {
    urgency = { text: `In ${daysAway} day${daysAway === 1 ? '' : 's'}`, color: c.textSecondary, bold: false };
  } else if (leave && minsUntilLeave <= 0) {
    urgency = { text: 'Leave now', color: c.accent, bold: true };
  } else if (leave && minsUntilLeave <= 15) {
    urgency = { text: `Leave in ${minsUntilLeave} min`, color: c.accent, bold: true };
  } else if (leave) {
    urgency = {
      text: `Leave by ${leave.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      color: c.text,
      bold: true,
    };
  } else {
    urgency = { text: formatCountdown(msUntilStart), color: c.text, bold: true };
  }

  const walkSourceNote =
    walk.source === 'override'
      ? 'your override'
      : walk.source === 'recorded'
        ? `avg of ${walk.sampleCount} timed walk${walk.sampleCount === 1 ? '' : 's'}`
        : 'estimate';

  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 2 }}>
        <Text
          style={{
            fontFamily: FONT.bold,
            fontSize: 12.5,
            color: c.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}>
          {isCurrent ? 'In session' : session.date === toISODate(now) ? 'Next class' : 'Next upcoming class'}
        </Text>
        <Text
          style={{
            fontFamily: urgency.bold ? FONT.bold : FONT.regular,
            fontSize: 13.5,
            color: urgency.color,
          }}>
          {urgency.text}
        </Text>
      </Row>

      <Card>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT.black, fontSize: 22, color: c.accent, letterSpacing: 0.2 }}>
              {course.code}
            </Text>
            {course.name && course.name.trim() !== course.code ? (
              <Body style={{ fontFamily: FONT.bold }}>{course.name}</Body>
            ) : null}
          </View>
          {/* Same-day countdown to the class starting — distinct from the
              walk-aware "leave by" line above, which is about departure,
              not the class itself. Not shown once in session (no "starts
              in" once it's started) or for classes on a different day
              (that's what the header's "In N days" already covers). */}
          {!isCurrent && session.date === toISODate(now) ? (
            <View
              style={{
                backgroundColor: c.accent + '14',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                alignItems: 'center',
                minWidth: 64,
              }}>
              <Text
                style={{
                  fontFamily: FONT.bold,
                  fontSize: 10.5,
                  color: c.accent,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                Starts in
              </Text>
              <Text
                style={{
                  fontFamily: FONT.black,
                  fontSize: 15,
                  color: c.accent,
                  fontVariant: ['tabular-nums'],
                }}>
                {formatCountdown(msUntilStart)}
              </Text>
            </View>
          ) : null}
        </Row>
        <Row style={{ marginTop: 6, marginBottom: 10, gap: 6 }}>
          {isCurrent ? <LiveDot color={c.accent} /> : null}
          <Badge label={MEETING_COMPONENT_LABEL[session.patternLabel]} tone="accent" />
          {session.status === 'moved' ? <Badge label="Moved" tone="warning" /> : null}
        </Row>

        <IconRow icon="time-outline" iconColor={c.accent}>
          {formatDateHuman(session.date)} · {formatTime12(session.startTime)}–{formatTime12(session.endTime)}
        </IconRow>
        <Pressable onPress={openDirections} accessibilityRole="button" accessibilityLabel="Open directions">
          <IconRow icon="location-outline" iconColor={c.accent}>
            {building ? `${building} ${room}`.trim() : 'Location not set'}
            {loc && loc.name.toLowerCase() !== building.toLowerCase() ? (
              <Text style={{ color: c.textSecondary, fontSize: 13.5 }}>
                {'\n'}
                {loc.name}
              </Text>
            ) : null}
            {loc?.entranceNotes ? (
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                {'\n'}
                {loc.entranceNotes}
              </Text>
            ) : null}
          </IconRow>
        </Pressable>
        {session.changeNote ? (
          <IconRow icon="information-circle-outline" color={c.warning}>
            {session.changeNote}
          </IconRow>
        ) : null}

        {!isCurrent ? (
          <>
            <Divider style={{ marginVertical: 10 }} />
            <Text
              style={{
                fontFamily: FONT.bold,
                fontSize: 12,
                color: c.accent,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 3,
              }}>
              Travel
            </Text>
            <Body style={{ marginBottom: 6 }}>
              {walk.minutes} min walk ({walkSourceNote})
              {leave ? (
                <Text style={{ fontFamily: FONT.bold, color: minsUntilLeave <= 15 ? c.accent : c.text }}>
                  {' '}
                  · {minsUntilLeave <= 0 ? 'leave now' : `leave by ${leave.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                </Text>
              ) : null}
            </Body>
            {!timerOpen ? (
              <Row>
                <View style={{ flex: 1 }}>
                  <Button label="Directions" icon="navigate-outline" onPress={openDirections} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Time route"
                    kind="secondary"
                    icon="stopwatch-outline"
                    onPress={() => setTimerOpen(true)}
                  />
                </View>
              </Row>
            ) : (
              <WalkTimerWidget
                toBuilding={building}
                onSaved={onWalkTimed}
                onClosed={() => setTimerOpen(false)}
              />
            )}
          </>
        ) : null}

        {!hasSyllabus ? (
          <>
            <Divider style={{ marginVertical: 8 }} />
            <Row style={{ justifyContent: 'space-between', minHeight: 30 }}>
              <Row style={{ gap: 8, flex: 1 }}>
                <Icon name="book-outline" size={15} />
                <Body secondary style={{ fontSize: 13 }}>
                  No syllabus linked
                </Body>
              </Row>
              <Button
                label="Add"
                kind="secondary"
                compact
                onPress={() => router.push(`/course/${course.id}`)}
              />
            </Row>
          </>
        ) : null}

        {importance && importance.level !== 'unknown' ? (
          <>
            <Divider style={{ marginVertical: 10 }} />
            <IconRow
              icon={
                importance.level === 'critical' || importance.level === 'high'
                  ? 'flame-outline'
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
            {importance.reasons.slice(0, 2).map((r, i) => (
              <Body key={i} secondary style={{ fontSize: 13, marginLeft: 24, lineHeight: 19 }}>
                {r}
                {importance.citations[i]
                  ? `  (${importance.citations[i].sourceFilename}${importance.citations[i].page ? `, p.${importance.citations[i].page}` : ''})`
                  : ''}
              </Body>
            ))}
          </>
        ) : null}

        <Divider style={{ marginVertical: 10 }} />

        {isCurrent ? (
          <Row>
            <View style={{ flex: 1.4 }}>
              <Button label="Mark attended" icon="checkmark" onPress={onAttended} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Can't make it" kind="danger-outline" onPress={onAbsent} />
            </View>
          </Row>
        ) : (
          <Row style={{ justifyContent: 'space-between' }}>
            <TextLink label="Notes" icon="create-outline" onPress={() => router.push(`/session/${session.id}`)} />
            <Button label="Mark absent" kind="danger-outline" compact onPress={onAbsent} />
          </Row>
        )}
      </Card>
    </View>
  );
}

/** Countdown timer card shown when a notification with a class time is clicked. */
function ClassCountdownCard({
  startTime,
  now,
  onDismiss,
}: {
  startTime: Date;
  now: Date;
  onDismiss: () => void;
}) {
  const c = useColors();
  const msUntilStart = startTime.getTime() - now.getTime();
  const minsUntilStart = Math.ceil(msUntilStart / 60000);
  const isClass = msUntilStart >= 0;

  return (
    <Card style={{ backgroundColor: c.subtle, marginBottom: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary, marginBottom: 2 }}>
            {isClass ? 'Class starts in' : 'Class started'}
          </Text>
          <Text
            style={{
              fontFamily: FONT.black,
              fontSize: 32,
              color: isClass ? c.accent : c.danger,
            }}>
            {isClass ? minsUntilStart : 'Now'}
          </Text>
          {isClass ? (
            <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary, marginTop: 2 }}>
              minute{minsUntilStart === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
        <Button
          label="Done"
          kind="secondary"
          compact
          onPress={onDismiss}
        />
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
function WalkTimerWidget({
  toBuilding,
  onSaved,
  onClosed,
}: {
  toBuilding: string;
  onSaved: () => void;
  /** When provided, the widget opens immediately and closing unmounts it. */
  onClosed?: () => void;
}) {
  const { db } = useApp();
  const c = useColors();
  const [stage, setStage] = useState<'closed' | 'picking' | 'ready' | 'running' | 'saved'>(
    onClosed ? 'picking' : 'closed',
  );
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
    if (onClosed) {
      onClosed();
      return;
    }
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
