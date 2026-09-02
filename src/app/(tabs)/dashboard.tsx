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
  Card,
  EmptyState,
  FONT,
  Icon,
  Loading,
  Row,
  Screen,
  Subtitle,
} from '@/components/ui';
import { SyllabusEventCard } from '@/components/SyllabusEventCard';
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  eventsRepo,
  plansRepo,
  syllabusCompletionsRepo,
  tasksRepo,
  type CalendarEvent,
} from '@/db/repo';
import {
  compareSyllabusEventPriority,
  detectSyllabusEvents,
  SYLLABUS_EVENT_LABEL,
  type DetectedSyllabusEvent,
} from '@/lib/syllabusDates';
import { compareISODate, formatDateHuman, isSameWeek, toISODate } from '@/lib/time';
import type { Absence, CatchUpPlan, CatchUpTask, Course, ResourceChunk } from '@/lib/types';
import { useApp } from '@/state/AppContext';

interface DashData {
  courses: Course[];
  absences: Absence[];
  plans: CatchUpPlan[];
  tasks: CatchUpTask[];
  events: CalendarEvent[];
  chunks: ResourceChunk[];
  doneChunkIds: Set<string>;
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
  const [collapsedCourseIds, setCollapsedCourseIds] = useState<Set<string>>(new Set());
  const toggleCourseCollapsed = (courseId: string) =>
    setCollapsedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        const [courses, absences, plans, tasks, events, chunks, doneChunkIds] = await Promise.all([
          coursesRepo.all(db),
          absencesRepo.all(db),
          plansRepo.all(db),
          tasksRepo.all(db),
          eventsRepo.all(db),
          chunksRepo.all(db),
          syllabusCompletionsRepo.all(db),
        ]);
        setData({ courses, absences, plans, tasks, events, chunks, doneChunkIds });
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

  // Quiz/exam/homework dates auto-detected from uploaded syllabi. Scoped to
  // the current Mon-Sun week only — a syllabus with frequent quizzes/
  // homework could otherwise fill the whole semester's worth of cards at
  // once. A student may have already added the same date via .ics import
  // or a manual calendar entry — skip anything whose generated title+date
  // already exists on the calendar rather than showing it twice.
  const existingEventKeys = new Set(data.events.map((e) => `${e.date}|${e.title}`));
  const thisWeekSyllabusEvents = detectSyllabusEvents(data.chunks)
    .filter((e) => isSameWeek(e.dateISO, today))
    .filter((e) => !existingEventKeys.has(`${e.dateISO}|${titleFor(byId.get(e.courseId), e)}`));

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

  const toggleSyllabusEventDone = async (event: DetectedSyllabusEvent) => {
    if (!db) return;
    await syllabusCompletionsRepo.setDone(db, event.chunkId, !data.doneChunkIds.has(event.chunkId));
    bump();
  };

  // Grouped per class so a week with several courses reads as one section
  // per class rather than one long, unordered list. Each group is sorted
  // by priority internally (exam > quiz > homework, then soonest date —
  // see compareSyllabusEventPriority), and the groups themselves are
  // ordered by their own most urgent item, so a class with an exam this
  // week surfaces above one with only a problem set due.
  const syllabusEventsByCourse = new Map<string, DetectedSyllabusEvent[]>();
  for (const e of thisWeekSyllabusEvents) {
    const list = syllabusEventsByCourse.get(e.courseId);
    if (list) list.push(e);
    else syllabusEventsByCourse.set(e.courseId, [e]);
  }
  const syllabusEventGroups = [...syllabusEventsByCourse.entries()]
    .map(([courseId, events]) => ({
      courseId,
      events: [...events].sort(compareSyllabusEventPriority),
    }))
    .sort((a, b) => compareSyllabusEventPriority(a.events[0], b.events[0]));

  // "Tonight": open plans ordered by most recent absence first.
  const tonight = openPlans.slice(0, 3);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {data.absences.length === 0 &&
        openPlans.length === 0 &&
        upcomingEvents.length === 0 &&
        thisWeekSyllabusEvents.length === 0 ? (
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

        {thisWeekSyllabusEvents.length > 0 ? (
          <>
            <Subtitle>This week, from your syllabi</Subtitle>
            {syllabusEventGroups.map(({ courseId, events }) => {
              const course = byId.get(courseId);
              const collapsed = collapsedCourseIds.has(courseId);
              return (
                <View key={courseId} style={{ marginBottom: 8 }}>
                  <Pressable
                    onPress={() => toggleCourseCollapsed(courseId)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !collapsed }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 6,
                      paddingHorizontal: 2,
                    }}>
                    <Icon name={collapsed ? 'chevron-forward' : 'chevron-down'} size={16} />
                    <Body style={{ fontFamily: FONT.bold, flex: 1 }}>{course?.code ?? '?'}</Body>
                    <Badge label={`${events.length}`} tone="neutral" />
                  </Pressable>
                  {collapsed
                    ? null
                    : events.map((e) => (
                        <SyllabusEventCard
                          key={e.chunkId}
                          event={e}
                          done={data.doneChunkIds.has(e.chunkId)}
                          onToggleDone={() => toggleSyllabusEventDone(e)}
                          onAddToCalendar={() => addSyllabusEventToCalendar(e)}
                        />
                      ))}
                </View>
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
