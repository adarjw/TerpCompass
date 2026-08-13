/** Schedule tab: week-at-a-glance list of sessions plus course management. */

import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  FONT,
  Loading,
  Row,
  Screen,
  Subtitle,
  useColors,
} from '@/components/ui';
import { coursesRepo, patternsRepo, sessionsRepo } from '@/db/repo';
import { sessionsOn } from '@/lib/sessions';
import { addDaysISO, formatDateHuman, formatTime12, toISODate } from '@/lib/time';
import type { ClassSession, Course, MeetingPattern } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { useApp } from '@/state/AppContext';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  scheduled: 'neutral',
  attended: 'success',
  absent: 'danger',
  canceled: 'warning',
  moved: 'warning',
};

export default function ScheduleScreen() {
  const { db, version } = useApp();
  const c = useColors();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [patterns, setPatterns] = useState<MeetingPattern[]>([]);

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
  const patternsByCourse = new Map<string, MeetingPattern[]>();
  for (const p of patterns) {
    patternsByCourse.set(p.courseId, [...(patternsByCourse.get(p.courseId) ?? []), p]);
  }
  const today = toISODate(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {courses.length === 0 ? (
          <EmptyState
            title="No classes yet"
            hint="Add a class manually or import your schedule to see your week here."
          />
        ) : (
          days.map((day) => {
            const daySessions = sessionsOn(sessions, day);
            if (daySessions.length === 0) return null;
            return (
              <View key={day} style={{ marginBottom: 8 }}>
                <Subtitle>{day === today ? `Today · ${formatDateHuman(day)}` : formatDateHuman(day)}</Subtitle>
                {daySessions.map((s) => {
                  const course = byId.get(s.courseId);
                  if (!course) return null;
                  return (
                    <Card key={s.id} style={{ paddingVertical: 12 }}>
                      <Pressable onPress={() => router.push(`/course/${course.id}`)}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Row style={{ gap: 8 }}>
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: course.color ?? c.accent,
                              }}
                            />
                            <Body style={{ fontFamily: FONT.bold }}>
                              {formatTime12(s.startTime)} {course.code}
                            </Body>
                          </Row>
                          <Badge label={s.status} tone={STATUS_TONE[s.status] ?? 'neutral'} />
                        </Row>
                        <Body secondary>
                          {MEETING_COMPONENT_LABEL[s.patternLabel]} ·{' '}
                          {[s.overrideBuilding ?? s.building, s.overrideRoom ?? s.room].filter(Boolean).join(' ') ||
                            'Location not set'}
                          {s.changeNote ? ` · ${s.changeNote}` : ''}
                        </Body>
                      </Pressable>
                      <Row>
                        <Button
                          label="Notes"
                          kind="ghost"
                          compact
                          onPress={() => router.push(`/session/${s.id}`)}
                        />
                        {s.status === 'scheduled' || s.status === 'moved' ? (
                          <Button
                            label="Mark missed"
                            kind="ghost"
                            compact
                            onPress={() => router.push(`/absence/${s.id}`)}
                          />
                        ) : null}
                      </Row>
                    </Card>
                  );
                })}
              </View>
            );
          })
        )}

        <Subtitle>Courses</Subtitle>
        {courses.map((course) => (
          <Pressable key={course.id} onPress={() => router.push(`/course/${course.id}`)}>
            <Card style={{ paddingVertical: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: FONT.bold }}>
                    {course.code} · {course.name}
                  </Body>
                  {(patternsByCourse.get(course.id) ?? []).map((p) => (
                    <Body key={p.id} secondary>
                      {MEETING_COMPONENT_LABEL[p.label]}:{' '}
                      {p.meetingDays.map((d) => WEEKDAY_SHORT[d]).join('')} ·{' '}
                      {formatTime12(p.startTime)}–{formatTime12(p.endTime)}
                    </Body>
                  ))}
                </View>
                <Text style={{ color: c.textSecondary, fontSize: 20 }}>›</Text>
              </Row>
            </Card>
          </Pressable>
        ))}
        <Button label="Add class" onPress={() => router.push('/course-edit')} />
        <Button label="Import (.ics / CSV / screenshot text / backup)" kind="secondary" onPress={() => router.push('/import')} />
        <Button label="Campus buildings & walking times" kind="secondary" onPress={() => router.push('/buildings')} />
      </ScrollView>
    </Screen>
  );
}
