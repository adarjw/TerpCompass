/**
 * Schedule tab — one day at a time.
 *
 * Compact app bar → sticky week navigation (‹ Aug 10–16 › · Today) → a
 * horizontal day selector → the selected day's classes as a timeline list:
 * fixed time column, hairline rail with course-colored dots, ~96px rows.
 * Status appears only when it means something (Next / In progress /
 * Attended / Missed / Canceled / Moved) — never a "Scheduled" pill on every
 * row. Tapping a row opens its details/notes; the ellipsis menu holds the
 * course link and the destructive "Mark missed".
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  courseColor,
  EmptyState,
  FONT,
  Icon,
  Loading,
  Row,
  Screen,
  Subtitle,
  TextLink,
  useColors,
} from '@/components/ui';
import { coursesRepo, patternsRepo, sessionsRepo } from '@/db/repo';
import { sessionEnd, sessionStart, sessionsOn, whereShouldIBe } from '@/lib/sessions';
import { addDaysISO, formatCountdown, formatTime12, parseISODate, toISODate } from '@/lib/time';
import type { ClassSession, Course, MeetingPattern } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { useApp } from '@/state/AppContext';

/** Monday of the week containing the given ISO date. */
function mondayOf(dateISO: string): string {
  const dp = parseISODate(dateISO);
  if (!dp) return dateISO;
  const d = new Date(dp.y, dp.m - 1, dp.d, 12);
  const offset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDaysISO(dateISO, -offset);
}

function monthDayLabel(dateISO: string): string {
  const dp = parseISODate(dateISO);
  if (!dp) return dateISO;
  return new Date(dp.y, dp.m - 1, dp.d, 12).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function weekLabel(weekStart: string): string {
  const end = addDaysISO(weekStart, 6);
  const startLabel = monthDayLabel(weekStart);
  const endDp = parseISODate(end)!;
  const startDp = parseISODate(weekStart)!;
  const endLabel =
    startDp.m === endDp.m ? String(endDp.d) : monthDayLabel(end);
  return `${startLabel}–${endLabel}`;
}

export default function ScheduleScreen() {
  const { db, version } = useApp();
  const c = useColors();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [patterns, setPatterns] = useState<MeetingPattern[]>([]);
  const today = toISODate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        setCourses(await coursesRepo.all(db));
        setSessions(await sessionsRepo.all(db));
        setPatterns(await patternsRepo.all(db));
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, version]),
  );

  if (!courses) return <Loading />;

  const byId = new Map(courses.map((co) => [co.id, co]));
  const now = new Date();
  const info = whereShouldIBe(sessions, byId, now);
  const nextId = info.next?.session.id ?? null;
  const currentId = info.current?.session.id ?? null;

  const weekStart = mondayOf(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const daySessions = sessionsOn(sessions, selectedDate);

  const patternsByCourse = new Map<string, MeetingPattern[]>();
  for (const p of patterns) {
    patternsByCourse.set(p.courseId, [...(patternsByCourse.get(p.courseId) ?? []), p]);
  }

  const markMissed = (sessionId: string) => {
    setMenuFor(null);
    router.push(`/absence/${sessionId}`);
  };

  return (
    <Screen>
      {/* Compact app bar */}
      <View
        style={{
          paddingTop: 14,
          paddingBottom: 8,
          paddingHorizontal: 16,
          backgroundColor: c.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 17, color: c.text }}>Schedule</Text>
          <Row style={{ gap: 2 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              onPress={() => setSelectedDate(addDaysISO(weekStart, -7))}
              style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.5 : 1 })}>
              <Ionicons name="chevron-back" size={18} color={c.text} />
            </Pressable>
            <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: c.text, minWidth: 86, textAlign: 'center' }}>
              {weekLabel(weekStart)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next week"
              onPress={() => setSelectedDate(addDaysISO(weekStart, 7))}
              style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.5 : 1 })}>
              <Ionicons name="chevron-forward" size={18} color={c.text} />
            </Pressable>
            {selectedDate !== today ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedDate(today)}
                style={({ pressed }) => ({
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: c.accent + '14',
                  opacity: pressed ? 0.6 : 1,
                })}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 13, color: c.accent }}>Today</Text>
              </Pressable>
            ) : null}
          </Row>
        </Row>

        {/* Day selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <Row style={{ gap: 6 }}>
            {weekDays.map((day) => {
              const dp = parseISODate(day)!;
              const selected = day === selectedDate;
              const isToday = day === today;
              const count = sessionsOn(sessions, day).length;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  onPress={() => setSelectedDate(day)}
                  style={({ pressed }) => ({
                    alignItems: 'center',
                    paddingVertical: 6,
                    paddingHorizontal: 11,
                    borderRadius: 8,
                    minWidth: 46,
                    backgroundColor: selected ? (isToday ? c.accent : c.subtle) : 'transparent',
                    borderWidth: 1,
                    borderColor: selected ? (isToday ? c.accent : c.inputBorder) : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  <Text
                    style={{
                      fontFamily: FONT.bold,
                      fontSize: 11,
                      color: selected && isToday ? c.accentText : isToday ? c.accent : c.textSecondary,
                    }}>
                    {WEEKDAY_SHORT[dp ? new Date(dp.y, dp.m - 1, dp.d, 12).getDay() : 0]}
                  </Text>
                  <Text
                    style={{
                      fontFamily: FONT.bold,
                      fontSize: 15,
                      color: selected && isToday ? c.accentText : c.text,
                    }}>
                    {parseISODate(day)!.d}
                  </Text>
                  {count > 0 && !(selected && isToday) ? (
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.textSecondary, marginTop: 2 }} />
                  ) : (
                    <View style={{ height: 6 }} />
                  )}
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
        {daySessions.length === 0 ? (
          <EmptyState
            icon="cafe-outline"
            title={`Nothing on ${monthDayLabel(selectedDate)}`}
            hint="No classes scheduled this day. Pick another day above, or add a class below."
          />
        ) : (
          daySessions.map((s, idx) => {
            const course = byId.get(s.courseId);
            if (!course) return null;
            const ended = (sessionEnd(s)?.getTime() ?? 0) < now.getTime();
            const isNext = s.id === nextId;
            const isCurrent = s.id === currentId;
            const dot = courseColor(course.code, course.color);
            const start = sessionStart(s);
            const msUntil = start ? start.getTime() - now.getTime() : 0;

            // Only meaningful states get a label.
            let status: { text: string; color: string } | null = null;
            if (isCurrent) status = { text: 'In progress', color: c.accent };
            else if (isNext) status = { text: `Next · in ${formatCountdown(msUntil)}`, color: c.accent };
            else if (s.status === 'attended') status = { text: 'Attended', color: c.success };
            else if (s.status === 'absent') status = { text: 'Missed', color: c.danger };
            else if (s.status === 'canceled') status = { text: 'Canceled', color: c.warning };
            else if (s.status === 'moved') status = { text: 'Moved', color: c.warning };

            const highlight = isNext || isCurrent;

            return (
              <View key={s.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${course.code} at ${formatTime12(s.startTime)}`}
                  onPress={() => router.push(`/session/${s.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    backgroundColor: highlight ? c.accent + '0D' : c.card,
                    borderWidth: highlight ? 1 : StyleSheet.hairlineWidth,
                    borderColor: highlight ? c.accent + '55' : c.border,
                    borderRadius: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    marginBottom: 12,
                    minHeight: 92,
                    opacity: pressed ? 0.7 : ended && !highlight ? 0.55 : 1,
                  })}>
                  {/* Fixed time column */}
                  <View style={{ width: 72 }}>
                    <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: c.text, fontVariant: ['tabular-nums'] }}>
                      {formatTime12(s.startTime)}
                    </Text>
                    <Text style={{ fontFamily: FONT.regular, fontSize: 12, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>
                      {formatTime12(s.endTime)}
                    </Text>
                  </View>

                  {/* Timeline rail + dot */}
                  <View style={{ width: 14, alignItems: 'center' }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: dot,
                        marginTop: 3,
                        borderWidth: isNext || isCurrent ? 2 : 0,
                        borderColor: c.accent,
                      }}
                    />
                    <View style={{ flex: 1, width: StyleSheet.hairlineWidth * 2, backgroundColor: c.hairline, marginTop: 4 }} />
                  </View>

                  {/* Course info */}
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ fontFamily: FONT.bold, fontSize: 15.5, color: c.text }} numberOfLines={1}>
                      {course.name && course.name !== course.code ? course.name : course.code}
                    </Text>
                    <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: c.textSecondary, marginTop: 2 }} numberOfLines={1}>
                      {course.code} · {MEETING_COMPONENT_LABEL[s.patternLabel]} ·{' '}
                      {[s.overrideBuilding ?? s.building, s.overrideRoom ?? s.room].filter(Boolean).join(' ') || 'No location'}
                    </Text>
                    {status ? (
                      <Text style={{ fontFamily: FONT.bold, fontSize: 12.5, color: status.color, marginTop: 4 }}>
                        {status.text}
                      </Text>
                    ) : null}
                    {s.changeNote ? (
                      <Text style={{ fontFamily: FONT.regular, fontSize: 12, color: c.warning, marginTop: 2 }} numberOfLines={1}>
                        {s.changeNote}
                      </Text>
                    ) : null}
                  </View>

                  {/* Overflow menu */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="More actions"
                    onPress={() => setMenuFor(menuFor === s.id ? null : s.id)}
                    hitSlop={8}
                    style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1, alignSelf: 'flex-start' })}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={c.textSecondary} />
                  </Pressable>
                </Pressable>

                {menuFor === s.id ? (
                  <View
                    style={{
                      backgroundColor: c.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      borderRadius: 8,
                      paddingVertical: 4,
                      paddingHorizontal: 12,
                      marginTop: -8,
                      marginBottom: 12,
                      marginLeft: 86,
                    }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setMenuFor(null);
                        router.push(`/course/${course.id}`);
                      }}
                      style={({ pressed }) => ({ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.5 : 1 })}>
                      <Icon name="book-outline" size={16} />
                      <Body style={{ fontSize: 14 }}>Course details</Body>
                    </Pressable>
                    {s.status === 'scheduled' || s.status === 'moved' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => markMissed(s.id)}
                        style={({ pressed }) => ({ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.5 : 1 })}>
                        <Icon name="close-circle-outline" size={16} color={c.danger} />
                        <Body style={{ fontSize: 14, color: c.danger }}>Mark missed</Body>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        <Subtitle>Courses</Subtitle>
        {courses.length === 0 ? (
          <Body secondary style={{ marginBottom: 8 }}>
            No courses yet — import a schedule or add one manually.
          </Body>
        ) : (
          courses.map((course) => (
            <Pressable key={course.id} onPress={() => router.push(`/course/${course.id}`)}>
              <Card style={{ paddingVertical: 10 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: 8, flex: 1 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: courseColor(course.code, course.color),
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontFamily: FONT.bold, fontSize: 14.5 }} numberOfLines={1}>
                        {course.code} · {course.name}
                      </Body>
                      {(patternsByCourse.get(course.id) ?? []).map((p) => (
                        <Body key={p.id} secondary style={{ fontSize: 12.5 }}>
                          {MEETING_COMPONENT_LABEL[p.label]}:{' '}
                          {p.meetingDays.map((d) => WEEKDAY_SHORT[d]).join('')} · {formatTime12(p.startTime)}–
                          {formatTime12(p.endTime)}
                        </Body>
                      ))}
                    </View>
                  </Row>
                  <Text style={{ color: c.textSecondary, fontSize: 18 }}>›</Text>
                </Row>
              </Card>
            </Pressable>
          ))
        )}
        <Button label="Add class" icon="add" onPress={() => router.push('/course-edit')} />
        <Row style={{ justifyContent: 'center', gap: 20, marginTop: 4 }}>
          <TextLink label="Import" icon="download-outline" onPress={() => router.push('/import')} />
          <TextLink label="Buildings" icon="business-outline" onPress={() => router.push('/buildings')} />
        </Row>
      </ScrollView>
    </Screen>
  );
}
