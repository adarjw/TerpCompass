/**
 * Dashboard: absences by course, open catch-up plans, repeated missed
 * topics, upcoming exams/deadlines, and "what should I catch up on tonight".
 */

import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  EmptyState,
  FONT,
  Icon,
  Loading,
  Row,
  Screen,
  Subtitle,
} from '@/components/ui';
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  eventsRepo,
  plansRepo,
  tasksRepo,
  type CalendarEvent,
} from '@/db/repo';
import { detectSyllabusEvents, SYLLABUS_EVENT_LABEL, type DetectedSyllabusEvent } from '@/lib/syllabusDates';
import { compareISODate, formatDateHuman, toISODate } from '@/lib/time';
import type { Absence, CatchUpPlan, CatchUpTask, Course, ResourceChunk } from '@/lib/types';
import { useApp } from '@/state/AppContext';

interface DashData {
  courses: Course[];
  absences: Absence[];
  plans: CatchUpPlan[];
  tasks: CatchUpTask[];
  events: CalendarEvent[];
  chunks: ResourceChunk[];
}

/** Same title format used both to insert a calendar event and to detect
 * whether a given detected event was already added, so a re-render never
 * shows a duplicate "Add" button for something already on the calendar. */
function titleFor(course: Course | undefined, event: DetectedSyllabusEvent): string {
  const label = SYLLABUS_EVENT_LABEL[event.kind];
  const topic = event.topic ? ` — ${event.topic}` : '';
  return `${course?.code ?? '?'}: ${label}${topic}`;
}

export default function DashboardScreen() {
  const { db, version, bump } = useApp();
  const [data, setData] = useState<DashData | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        const [courses, absences, plans, tasks, events, chunks] = await Promise.all([
          coursesRepo.all(db),
          absencesRepo.all(db),
          plansRepo.all(db),
          tasksRepo.all(db),
          eventsRepo.all(db),
          chunksRepo.all(db),
        ]);
        setData({ courses, absences, plans, tasks, events, chunks });
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, version]),
  );

  if (!data) return <Loading />;

  const byId = new Map(data.courses.map((co) => [co.id, co]));
  const today = toISODate(new Date());

  const openTasksByPlan = new Map<string, CatchUpTask[]>();
  for (const t of data.tasks) {
    if (!t.done) {
      openTasksByPlan.set(t.planId, [...(openTasksByPlan.get(t.planId) ?? []), t]);
    }
  }
  const openPlans = data.plans.filter(
    (p) => (openTasksByPlan.get(p.id)?.length ?? 0) > 0 || data.tasks.every((t) => t.planId !== p.id),
  );

  const absencesByCourse = new Map<string, Absence[]>();
  for (const a of data.absences) {
    absencesByCourse.set(a.courseId, [...(absencesByCourse.get(a.courseId) ?? []), a]);
  }

  // Topics missed more than once (from plan topics).
  const topicCounts = new Map<string, number>();
  for (const p of data.plans) {
    if (p.likelyTopic) {
      const key = p.likelyTopic.toLowerCase();
      topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
    }
  }
  const repeatedTopics = [...topicCounts.entries()].filter(([, n]) => n > 1);

  const upcomingEvents = data.events
    .filter((e) => compareISODate(e.date, today) >= 0)
    .slice(0, 6);

  // Quiz/exam/homework dates auto-detected from uploaded syllabi. A student
  // may have already added the same date via .ics import or a manual
  // calendar entry — skip anything whose generated title+date already
  // exists on the calendar rather than showing it twice.
  const existingEventKeys = new Set(data.events.map((e) => `${e.date}|${e.title}`));
  const upcomingSyllabusEvents = detectSyllabusEvents(data.chunks)
    .filter((e) => compareISODate(e.dateISO, today) >= 0)
    .filter((e) => !existingEventKeys.has(`${e.dateISO}|${titleFor(byId.get(e.courseId), e)}`))
    .slice(0, 8);

  const addSyllabusEventToCalendar = async (event: DetectedSyllabusEvent) => {
    if (!db) return;
    await eventsRepo.insertMany(db, [
      {
        title: titleFor(byId.get(event.courseId), event),
        date: event.dateISO,
        time: null,
        kind: event.kind === 'exam' ? 'exam' : 'deadline',
      },
    ]);
    bump();
  };

  // "Tonight": open plans ordered by most recent absence first.
  const tonight = openPlans.slice(0, 3);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {data.absences.length === 0 &&
        openPlans.length === 0 &&
        upcomingEvents.length === 0 &&
        upcomingSyllabusEvents.length === 0 ? (
          <EmptyState
            title="All caught up"
            hint="Missed classes, catch-up plans, and exam/quiz/homework dates from your syllabi will show up here."
          />
        ) : null}

        {tonight.length > 0 ? (
          <>
            <Subtitle>What should I catch up on tonight?</Subtitle>
            {tonight.map((p) => {
              const course = byId.get(p.courseId);
              return (
                <Pressable key={p.id} onPress={() => router.push(`/plan/${p.id}`)}>
                  <Card>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Row style={{ gap: 8 }}>
                        <Icon name="book-outline" size={17} />
                        <Body style={{ fontFamily: FONT.bold }}>{course?.code ?? '?'}</Body>
                      </Row>
                      <Badge
                        label={p.confidence === 'none' ? 'Topic unknown' : (p.likelyTopic ?? 'Plan')}
                        tone={p.confidence === 'none' ? 'warning' : 'accent'}
                      />
                    </Row>
                    <Body secondary>
                      Missed {formatDateHuman(p.sessionDate)}
                      {p.estimatedMinutes ? ` · ~${p.estimatedMinutes} min` : ''}
                      {p.aiGenerated ? ' · AI-generated' : ''}
                    </Body>
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {data.absences.length > 0 ? (
          <>
            <Subtitle>Missed classes by course</Subtitle>
            <Card>
              {[...absencesByCourse.entries()].map(([courseId, list]) => {
                const course = byId.get(courseId);
                if (!course) return null;
                return (
                  <Row key={courseId} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <Body>
                      {course.code} · {course.name}
                    </Body>
                    <Badge
                      label={`${list.length} missed`}
                      tone={list.length >= 3 ? 'danger' : list.length === 2 ? 'warning' : 'neutral'}
                    />
                  </Row>
                );
              })}
            </Card>
          </>
        ) : null}

        {repeatedTopics.length > 0 ? (
          <>
            <Subtitle>Topics missed more than once</Subtitle>
            <Card>
              {repeatedTopics.map(([topic, n]) => (
                <Body key={topic}>
                  • {topic} ({n}×)
                </Body>
              ))}
            </Card>
          </>
        ) : null}

        {upcomingEvents.length > 0 ? (
          <>
            <Subtitle>Upcoming exams & deadlines (from calendar)</Subtitle>
            {upcomingEvents.map((e) => (
              <Card key={e.id} style={{ paddingVertical: 12 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontFamily: FONT.bold }}>{e.title}</Body>
                    <Body secondary>{formatDateHuman(e.date)}</Body>
                  </View>
                  <Badge label={e.kind} tone={e.kind === 'exam' ? 'danger' : 'warning'} />
                </Row>
              </Card>
            ))}
          </>
        ) : null}

        {upcomingSyllabusEvents.length > 0 ? (
          <>
            <Subtitle>Detected from your syllabi</Subtitle>
            {upcomingSyllabusEvents.map((e) => {
              const course = byId.get(e.courseId);
              return (
                <Card key={e.chunkId} style={{ paddingVertical: 12 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Row style={{ gap: 8, marginBottom: 2 }}>
                        <Body style={{ fontFamily: FONT.bold }}>{course?.code ?? '?'}</Body>
                        <Badge
                          label={SYLLABUS_EVENT_LABEL[e.kind]}
                          tone={e.kind === 'exam' ? 'danger' : e.kind === 'quiz' ? 'warning' : 'neutral'}
                        />
                      </Row>
                      {e.topic ? <Body>{e.topic}</Body> : null}
                      <Body secondary style={{ fontSize: 13 }}>
                        {formatDateHuman(e.dateISO)} · {e.sourceFilename}
                        {e.page ? `, p.${e.page}` : ''}
                      </Body>
                    </View>
                    <Button
                      label="Add to calendar"
                      kind="secondary"
                      compact
                      onPress={() => addSyllabusEventToCalendar(e)}
                    />
                  </Row>
                </Card>
              );
            })}
          </>
        ) : null}

        {data.plans.length > 0 ? (
          <>
            <Subtitle>All catch-up plans</Subtitle>
            {data.plans.map((p) => {
              const course = byId.get(p.courseId);
              const open = openTasksByPlan.get(p.id)?.length ?? 0;
              return (
                <Pressable key={p.id} onPress={() => router.push(`/plan/${p.id}`)}>
                  <Card style={{ paddingVertical: 12 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Body>
                        {course?.code ?? '?'} · {formatDateHuman(p.sessionDate)}
                      </Body>
                      <Badge label={open > 0 ? `${open} open` : 'done'} tone={open > 0 ? 'warning' : 'success'} />
                    </Row>
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
