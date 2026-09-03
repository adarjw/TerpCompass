/** Course detail: info, attendance, resources (attach/extract), absences. */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Row,
  Screen,
  Subtitle,
  Title,
  FONT,
} from '@/components/ui';
import { SyllabusEventCard } from '@/components/SyllabusEventCard';
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  eventsRepo,
  locationsRepo,
  patternsRepo,
  planetTerpCacheRepo,
  resourcesRepo,
  syllabusCompletionsRepo,
  type CalendarEvent,
} from '@/db/repo';
import { findBuilding } from '@/lib/campus';
import { prefersAppleMapsForCurrentDevice } from '@/lib/browserEnv';
import type { DetectedContacts } from '@/lib/syllabus';
import {
  compareSyllabusEventPriority,
  detectSyllabusEvents,
  SYLLABUS_EVENT_LABEL,
  type DetectedSyllabusEvent,
} from '@/lib/syllabusDates';
import { formatDateHuman, formatTime12, isSameWeek, toISODate } from '@/lib/time';
import type {
  Absence,
  CampusLocation,
  Course,
  MeetingPattern,
  Resource,
  ResourceChunk,
  ResourceKind,
} from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { bestMapUrl } from '@/lib/walking';
import { openExternalUrl } from '@/services/externalLinks';
import {
  attachFileResource,
  attachTextResource,
  deleteSandboxFile,
  pickDocument,
} from '@/services/files';
import { fetchEnrichment, type PlanetTerpEnrichment } from '@/services/planetterp';
import { useApp } from '@/state/AppContext';

const KIND_LABELS: { kind: ResourceKind; label: string }[] = [
  { kind: 'syllabus', label: 'Syllabus' },
  { kind: 'slides', label: 'Slides' },
  { kind: 'notes', label: 'Notes' },
  { kind: 'problem_set', label: 'Problem set' },
  { kind: 'reading_list', label: 'Readings' },
  { kind: 'announcement', label: 'Announcement' },
];

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, version, bump, rescheduleNotifications } = useApp();
  const [course, setCourse] = useState<Course | null>(null);
  const [patterns, setPatterns] = useState<MeetingPattern[]>([]);
  const [buildings, setBuildings] = useState<CampusLocation[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteMode, setPasteMode] = useState<ResourceKind | null>(null);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [enrich, setEnrich] = useState<PlanetTerpEnrichment | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [showAllProfs, setShowAllProfs] = useState(false);
  const [contactsNote, setContactsNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveResource, setConfirmRemoveResource] = useState<Resource | null>(null);
  const [chunks, setChunks] = useState<ResourceChunk[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [doneChunkIds, setDoneChunkIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db || !id) return;
        const loaded = await coursesRepo.byId(db, id);
        setCourse(loaded);
        setPatterns(await patternsRepo.forCourse(db, id));
        setBuildings(await locationsRepo.all(db));
        setResources(await resourcesRepo.forCourse(db, id));
        setAbsences(await absencesRepo.forCourse(db, id));
        setChunks(await chunksRepo.forCourse(db, id));
        setCalendarEvents(await eventsRepo.all(db));
        setDoneChunkIds(await syllabusCompletionsRepo.all(db));
        if (loaded) {
          const cached = await planetTerpCacheRepo.get<PlanetTerpEnrichment>(db, loaded.code);
          setEnrich(cached?.payload ?? null);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, id, version]),
  );

  if (!course) return <Loading />;

  // Quiz/exam/homework dates auto-detected from this course's own syllabus
  // (see src/lib/syllabusDates.ts) — same detector, week scope, and "Add to
  // calendar" dedup pattern as the Dashboard's aggregate view, here scoped
  // to just this course so it reads as "what's coming up in this class."
  const courseSyllabusTitleFor = (event: DetectedSyllabusEvent) => {
    const label = SYLLABUS_EVENT_LABEL[event.kind];
    const topic = event.topic ? ` — ${event.topic}` : '';
    return `${course.code}: ${label}${topic}`;
  };
  const today = toISODate(new Date());
  const existingCourseEventKeys = new Set(calendarEvents.map((e) => `${e.date}|${e.title}`));
  const thisWeekCourseSyllabusEvents = detectSyllabusEvents(chunks)
    .filter((e) => isSameWeek(e.dateISO, today))
    .filter((e) => !existingCourseEventKeys.has(`${e.dateISO}|${courseSyllabusTitleFor(e)}`))
    .sort(compareSyllabusEventPriority);

  const addCourseSyllabusEventToCalendar = async (event: DetectedSyllabusEvent) => {
    if (!db) return;
    await eventsRepo.insertMany(db, [
      {
        title: courseSyllabusTitleFor(event),
        date: event.dateISO,
        time: null,
        kind: event.kind === 'exam' ? 'exam' : 'deadline',
      },
    ]);
    bump();
  };

  const toggleCourseSyllabusEventDone = async (event: DetectedSyllabusEvent) => {
    if (!db) return;
    await syllabusCompletionsRepo.setDone(db, event.chunkId, !doneChunkIds.has(event.chunkId));
    bump();
  };

  const runEnrich = async () => {
    if (!db) return;
    setEnrichBusy(true);
    setEnrichNote(null);
    try {
      const result = await fetchEnrichment(course.code, course.professor, course.semesterStart);
      if (!result.ok) {
        setEnrichNote(result.error);
        return;
      }
      await planetTerpCacheRepo.set(db, course.code, result.value);
      setEnrich(result.value);
      // Autofill the real course title when the name is still just the code
      // (typical after a screenshot import) — factual, low-risk, reversible
      // via Edit.
      if (result.value.title && course.name.trim() === course.code) {
        await coursesRepo.upsert(db, { ...course, name: result.value.title });
        setEnrichNote(`Course name set to "${result.value.title}".`);
        bump();
      }
    } finally {
      setEnrichBusy(false);
    }
  };

  const acceptPolicySuggestion = async () => {
    if (!db || !enrich?.policySuggestion) return;
    await coursesRepo.upsert(db, { ...course, attendancePolicy: enrich.policySuggestion });
    setEnrichNote('Attendance policy filled from PlanetTerp reviews — replace it with the syllabus wording when you have it.');
    bump();
  };

  const setProfessor = async (name: string) => {
    if (!db) return;
    await coursesRepo.upsert(db, { ...course, professor: name });
    bump();
  };

  /**
   * Autofill professor/TA emails from a syllabus upload — only into fields
   * that are still blank, and only what's literally in the document (never
   * overwrites something already entered; always reversible via Edit).
   */
  const applyDetectedContacts = async (contacts: DetectedContacts | undefined) => {
    if (!db || !contacts) return;
    const updates: Partial<Course> = {};
    if (!course.professorEmail && contacts.professorEmail) {
      updates.professorEmail = contacts.professorEmail;
    }
    if (!course.taEmails && contacts.taEmails.length > 0) {
      updates.taEmails = contacts.taEmails.join(', ');
    }
    if (Object.keys(updates).length === 0) return;
    const updated = { ...course, ...updates };
    await coursesRepo.upsert(db, updated);
    setCourse(updated);
    bump();
    const filled = [
      updates.professorEmail ? 'professor email' : null,
      updates.taEmails ? 'TA email(s)' : null,
    ]
      .filter(Boolean)
      .join(' and ');
    setContactsNote(`Filled ${filled} from the syllabus — check Edit if it's not right.`);
  };

  const semesterYear = Number(course.semesterStart.slice(0, 4)) || new Date().getFullYear();

  const attachFile = async (kind: ResourceKind) => {
    if (!db) return;
    setError(null);
    setBusy(true);
    try {
      const picked = await pickDocument();
      if (picked) {
        const result = await attachFileResource(db, course.id, kind, picked, semesterYear);
        if (result.warning) setError(result.warning);
        await applyDetectedContacts(result.contacts);
        bump();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePaste = async () => {
    if (!db || !pasteMode) return;
    try {
      const result = await attachTextResource(db, course.id, pasteMode, pasteTitle || 'Pasted text', pasteText, semesterYear);
      await applyDetectedContacts(result.contacts);
      setPasteMode(null);
      setPasteTitle('');
      setPasteText('');
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeResource = (res: Resource) => setConfirmRemoveResource(res);

  const confirmRemoveResourceAction = async () => {
    if (!db || !confirmRemoveResource) return;
    await resourcesRepo.remove(db, confirmRemoveResource.id);
    await deleteSandboxFile(db, confirmRemoveResource.fileUri);
    setConfirmRemoveResource(null);
    bump();
  };

  const removeCourse = () => setConfirmDelete(true);

  const confirmRemoveCourse = async () => {
    if (!db) return;
    await coursesRepo.remove(db, course.id);
    bump();
    await rescheduleNotifications();
    router.back();
  };

  return (
    <Screen>
      <ConfirmModal
        visible={confirmDelete}
        title="Delete this course?"
        message="All sessions, absences, resources, and plans for it will be removed. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmRemoveCourse}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmModal
        visible={confirmRemoveResource !== null}
        title="Remove resource?"
        message={confirmRemoveResource?.title ?? ''}
        confirmLabel="Remove"
        onConfirm={confirmRemoveResourceAction}
        onCancel={() => setConfirmRemoveResource(null)}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Title>
          {course.code} · {course.name}
        </Title>
        <Card>
          {course.professor ? <Body secondary>{course.professor}</Body> : null}
          {patterns.map((p) => {
            const loc = findBuilding(buildings, p.building);
            const where = [p.building, p.room].filter(Boolean).join(' ');
            return (
              <Row key={p.id} style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: FONT.bold }}>{MEETING_COMPONENT_LABEL[p.label]}</Body>
                  <Body secondary>
                    {p.meetingDays.map((d) => WEEKDAY_SHORT[d]).join('')} · {formatTime12(p.startTime)}–
                    {formatTime12(p.endTime)} · {where || 'Location not set'}
                  </Body>
                </View>
                <Button
                  label="Directions"
                  kind="ghost"
                  compact
                  onPress={() =>
                    openExternalUrl(
                      bestMapUrl(loc, where || course.code, prefersAppleMapsForCurrentDevice(Platform.OS)),
                    )
                  }
                />
              </Row>
            );
          })}
          <Body secondary style={{ marginTop: 6 }}>
            Semester: {formatDateHuman(course.semesterStart)} → {formatDateHuman(course.semesterEnd)}
          </Body>
          {course.attendancePolicy ? (
            <Body secondary style={{ marginTop: 6 }}>
              Attendance policy: {course.attendancePolicy}
            </Body>
          ) : null}
          <Row style={{ marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Edit"
                kind="secondary"
                compact
                onPress={() => router.push({ pathname: '/course-edit', params: { id: course.id } })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Delete" kind="ghost" compact onPress={removeCourse} />
            </View>
          </Row>
        </Card>

        {thisWeekCourseSyllabusEvents.length > 0 ? (
          <>
            <Subtitle>This week: quizzes, exams & homework (from syllabus)</Subtitle>
            {thisWeekCourseSyllabusEvents.map((e) => (
              <SyllabusEventCard
                key={e.chunkId}
                event={e}
                done={doneChunkIds.has(e.chunkId)}
                onToggleDone={() => toggleCourseSyllabusEventDone(e)}
                onAddToCalendar={() => addCourseSyllabusEventToCalendar(e)}
              />
            ))}
          </>
        ) : null}

        {absences.length > 0 ? (
          <Card>
            <Subtitle>Missed classes: {absences.length}</Subtitle>
            {absences.slice(0, 5).map((a) => (
              <Body key={a.id} secondary>
                • {formatDateHuman(a.date)}
                {a.reason ? ` — ${a.reason}` : ''}
              </Body>
            ))}
          </Card>
        ) : null}

        <Subtitle>PlanetTerp</Subtitle>
        <Card>
          {enrichNote ? (
            <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
              {enrichNote}
            </Body>
          ) : null}
          {enrich ? (
            <>
              <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
                {enrich.averageGpa != null ? <Badge label={`Avg GPA ${enrich.averageGpa}`} /> : null}
                {Object.entries(enrich.professorRatings).map(([name, rating]) => (
                  <Badge key={name} label={`${name}: ${rating}/5`} tone={rating >= 3.5 ? 'success' : rating < 2.5 ? 'warning' : 'neutral'} />
                ))}
              </Row>
              {!course.professor && (enrich.professors.length > 0 || (enrich.currentInstructors ?? []).length > 0) ? (
                <>
                  <Body secondary style={{ fontSize: 13, marginBottom: 4 }}>
                    Set the professor (improves review matching):
                  </Body>
                  {(() => {
                    // Teaching-this-term names first (umd.io Schedule of
                    // Classes), then PlanetTerp's historical roster.
                    // Older cache entries predate currentInstructors.
                    const current = enrich.currentInstructors ?? [];
                    const currentKeys = new Set(current.map((n) => n.toLowerCase()));
                    const historical = enrich.professors.filter((n) => !currentKeys.has(n.toLowerCase()));
                    return (
                      <>
                        {current.length > 0 ? (
                          <>
                            <Body secondary style={{ fontSize: 12, marginBottom: 2 }}>
                              Teaching this semester or recently:
                            </Body>
                            <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
                              {(showAllProfs ? current : current.slice(0, 8)).map((name) => (
                                <View key={name} style={{ minWidth: 120 }}>
                                  <Button label={name} kind="tonal" compact onPress={() => setProfessor(name)} />
                                </View>
                              ))}
                            </Row>
                            {current.length > 8 && !showAllProfs ? (
                              <Button
                                label={`Show all ${current.length}`}
                                kind="ghost"
                                compact
                                onPress={() => setShowAllProfs(true)}
                              />
                            ) : null}
                          </>
                        ) : null}
                        {historical.length > 0 ? (
                          <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
                            {historical.slice(0, current.length > 0 ? 3 : 6).map((name) => (
                              <View key={name} style={{ minWidth: 120 }}>
                                <Button label={name} kind="secondary" compact onPress={() => setProfessor(name)} />
                              </View>
                            ))}
                          </Row>
                        ) : null}
                      </>
                    );
                  })()}
                </>
              ) : null}
              {enrich.hints.length > 0 ? (
                <>
                  <Body style={{ fontFamily: FONT.bold, fontSize: 14, marginTop: 4 }}>
                    What reviews say about attendance
                  </Body>
                  {enrich.hints.slice(0, 4).map((h, i) => (
                    <Body key={i} secondary style={{ fontSize: 13, marginTop: 4 }}>
                      &ldquo;{h.text}&rdquo;{h.course ? ` — ${h.course} review` : ' — review'}
                    </Body>
                  ))}
                  {enrich.policySuggestion ? (
                    <Button
                      label={course.attendancePolicy ? 'Replace attendance policy with this' : 'Use as attendance policy'}
                      kind="secondary"
                      compact
                      icon="download-outline"
                      onPress={acceptPolicySuggestion}
                    />
                  ) : null}
                </>
              ) : (
                <Body secondary style={{ fontSize: 13 }}>
                  No attendance mentions found in reviews for this course.
                </Body>
              )}
              <Button
                label={enrichBusy ? 'Refreshing…' : 'Refresh'}
                kind="ghost"
                compact
                disabled={enrichBusy}
                onPress={runEnrich}
              />
            </>
          ) : (
            <>
              <Body secondary style={{ fontSize: 13, marginBottom: 6 }}>
                Pull the real course title, professor ratings, and what student reviews say about
                attendance — free, no account, fetched only when you tap and cached for offline use.
              </Body>
              <Button
                label={enrichBusy ? 'Fetching…' : 'Fetch from PlanetTerp'}
                kind="secondary"
                icon="cloud-download-outline"
                disabled={enrichBusy}
                onPress={runEnrich}
              />
            </>
          )}
        </Card>

        <Subtitle>Resources</Subtitle>
        {error ? <ErrorBox message={error} /> : null}
        {contactsNote ? (
          <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
            {contactsNote}
          </Body>
        ) : null}
        {resources.length === 0 ? (
          <EmptyState
            title="No resources yet"
            hint="Attach the syllabus PDF, slides, notes, or paste announcement text. The app reads them on-device to power catch-up plans and the attendance-importance meter."
          />
        ) : (
          resources.map((res) => (
            <Card key={res.id} style={{ paddingVertical: 12 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: FONT.bold }}>{res.title}</Body>
                  <Row style={{ marginTop: 4 }}>
                    <Badge label={res.kind.replace('_', ' ')} />
                    {res.extractionStatus === 'ok' ? (
                      <Badge label="text extracted" tone="success" />
                    ) : res.extractionStatus === 'no_text' ? (
                      <Badge label="no text found" tone="warning" />
                    ) : res.extractionStatus === 'error' ? (
                      <Badge label="read error" tone="danger" />
                    ) : null}
                  </Row>
                  {res.extractionError ? (
                    <Body secondary style={{ fontSize: 12, marginTop: 4 }}>
                      {res.extractionError}
                    </Body>
                  ) : null}
                </View>
                <Button label="Remove" icon="trash-outline" kind="ghost" compact onPress={() => removeResource(res)} />
              </Row>
            </Card>
          ))
        )}

        <Card>
          <Subtitle>Attach a file</Subtitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {KIND_LABELS.map(({ kind, label }) => (
              <View key={kind} style={{ minWidth: 110, flex: 1 }}>
                <Button label={label} kind="secondary" compact disabled={busy} onPress={() => attachFile(kind)} />
              </View>
            ))}
          </Row>
          <Button
            label="Paste text instead"
            kind="ghost"
            compact
            onPress={() => setPasteMode(pasteMode ? null : 'notes')}
          />
          {pasteMode ? (
            <>
              <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                {KIND_LABELS.map(({ kind, label }) => (
                  <View key={kind} style={{ minWidth: 100, flex: 1 }}>
                    <Button
                      label={label}
                      kind={pasteMode === kind ? 'primary' : 'secondary'}
                      compact
                      onPress={() => setPasteMode(kind)}
                    />
                  </View>
                ))}
              </Row>
              <Field label="Title" value={pasteTitle} onChangeText={setPasteTitle} placeholder="Week 5 announcement" />
              <Field
                label="Text"
                value={pasteText}
                onChangeText={setPasteText}
                multiline
                placeholder="Paste syllabus schedule, announcement, or notes text here…"
              />
              <Button label="Save pasted text" onPress={savePaste} disabled={!pasteText.trim()} />
            </>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}
