/**
 * Import hub: .ics, CSV, pasted screenshot text, and JSON backup restore.
 * Every path shows a preview + warnings before anything is written.
 */

import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Row,
  Screen,
  Subtitle,
  useColors,
} from '@/components/ui';
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  eventsRepo,
  locationsRepo,
  patternsRepo,
  plansRepo,
  resourcesRepo,
  sessionsRepo,
  tasksRepo,
} from '@/db/repo';
import { validateBackup } from '@/lib/backup';
import { parseCsvSchedule, normalizeDate } from '@/lib/csv';
import { parseIcs, type CalendarEventDraft, type CourseDraft } from '@/lib/ics';
import { makeId } from '@/lib/ids';
import { parseScheduleText } from '@/lib/scheduleText';
import { generateSessions } from '@/lib/sessions';
import type { Course, MeetingPattern } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { pickDocument, readTextFile, validateImportedFile } from '@/services/files';
import { useApp } from '@/state/AppContext';

type Draft = CourseDraft & { attendancePolicy?: string; walkingBufferMin?: number };

export default function ImportScreen() {
  const { db, bump, rescheduleNotifications } = useApp();
  const c = useColors();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [events, setEvents] = useState<CalendarEventDraft[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteSemStart, setPasteSemStart] = useState('');
  const [pasteSemEnd, setPasteSemEnd] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setWarnings([]);
    setDrafts([]);
    setEvents([]);
    setDone(null);
  };

  const pickAndParse = async (kind: 'ics' | 'csv' | 'backup') => {
    reset();
    try {
      const picked = await pickDocument(['*/*']);
      if (!picked) return;
      const invalid = validateImportedFile(picked.name, picked.size);
      if (invalid) {
        setError(invalid);
        return;
      }
      const text = await readTextFile(picked.uri);
      if (kind === 'ics' || (kind !== 'backup' && picked.name.toLowerCase().endsWith('.ics'))) {
        const result = parseIcs(text);
        setDrafts(result.courses);
        setEvents(result.events);
        setWarnings(result.warnings);
        if (result.courses.length === 0 && result.events.length === 0 && result.warnings.length === 0) {
          setError('Nothing importable was found in that calendar.');
        }
      } else if (kind === 'csv') {
        const result = parseCsvSchedule(text);
        setDrafts(result.courses);
        setWarnings(result.warnings);
      } else {
        await restoreBackup(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const parsePasted = () => {
    reset();
    const semStart = normalizeDate(pasteSemStart);
    const semEnd = normalizeDate(pasteSemEnd);
    if (!semStart || !semEnd) {
      setError('Enter the semester start and end dates (like 2026-08-31) so class sessions can be generated.');
      return;
    }
    const result = parseScheduleText(pasteText);
    setWarnings([...result.warnings, ...result.partial.map((p) => `Needs manual entry: ${p.split('\n')[0]}`)]);
    setDrafts(result.courses.map((co) => ({ ...co, semesterStart: semStart, semesterEnd: semEnd })));
  };

  const restoreBackup = async (text: string) => {
    if (!db) return;
    const validation = validateBackup(text);
    if (!validation.ok || !validation.doc) {
      setError(`Backup rejected:\n${validation.errors.join('\n')}`);
      return;
    }
    const doc = validation.doc;
    for (const course of doc.courses) await coursesRepo.upsert(db, course);
    await patternsRepo.insertMany(db, doc.patterns);
    await sessionsRepo.insertMany(db, doc.sessions);
    for (const a of doc.absences) await absencesRepo.insert(db, a);
    for (const r of doc.resources) await resourcesRepo.insert(db, r);
    await chunksRepo.insertMany(db, doc.chunks);
    for (const p of doc.plans) await plansRepo.save(db, p);
    for (const t of doc.tasks) await tasksRepo.insert(db, t);
    for (const l of doc.locations) await locationsRepo.upsert(db, l);
    bump();
    await rescheduleNotifications();
    setDone(`Restored ${doc.courses.length} courses, ${doc.sessions.length} sessions, ${doc.plans.length} plans.`);
  };

  const confirmImport = async () => {
    if (!db) return;
    try {
      let imported = 0;
      for (const draft of drafts) {
        const course: Course = {
          id: makeId(),
          code: draft.code || `COURSE${imported + 1}`,
          name: draft.name || draft.code,
          professor: draft.professor,
          semesterStart: draft.semesterStart,
          semesterEnd: draft.semesterEnd,
          attendancePolicy: draft.attendancePolicy,
          walkingBufferMin: draft.walkingBufferMin,
          createdAt: new Date().toISOString(),
        };
        const patternRows: MeetingPattern[] = draft.patterns.map((p) => ({
          id: makeId(),
          courseId: course.id,
          label: p.label,
          building: p.building,
          room: p.room,
          meetingDays: p.meetingDays,
          startTime: p.startTime,
          endTime: p.endTime,
        }));
        await coursesRepo.upsert(db, course);
        await patternsRepo.insertMany(db, patternRows);
        await sessionsRepo.insertMany(db, generateSessions(course, patternRows, makeId));
        imported++;
      }
      if (events.length > 0) await eventsRepo.insertMany(db, events);
      bump();
      await rescheduleNotifications();
      setDrafts([]);
      setEvents([]);
      setDone(
        `Imported ${imported} course${imported === 1 ? '' : 's'}${events.length ? ` and ${events.length} calendar event(s)` : ''}. Reminders re-scheduled.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        {error ? <ErrorBox message={error} /> : null}
        {done ? (
          <Card>
            <Badge label="Success" tone="success" />
            <Body style={{ marginTop: 6 }}>{done}</Body>
            <Button label="Back to schedule" onPress={() => router.back()} />
          </Card>
        ) : null}

        <Subtitle>Pick a source</Subtitle>
        <Card>
          <Button label="Calendar file (.ics)" kind="secondary" onPress={() => pickAndParse('ics')} />
          <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
            Export from Testudo/Google Calendar. Weekly classes become courses; one-off exam/due
            events land on the dashboard.
          </Body>
          <Button label="Spreadsheet (.csv)" kind="secondary" onPress={() => pickAndParse('csv')} />
          <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
            Columns: code, name, professor, component, building, room, days, start, end,
            semester_start, semester_end, attendance_policy, walking_buffer. Give a course&apos;s
            Lecture and Discussion/Lab their own rows sharing the same code, distinguished by
            &quot;component&quot;.
          </Body>
          <Button label="Paste text from a schedule screenshot" kind="secondary" onPress={() => setPasteOpen(!pasteOpen)} />
          <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
            Long-press your schedule screenshot → copy the text (Live Text / Lens) → paste here. No
            AI needed.
          </Body>
          <Button label="Restore JSON backup" kind="secondary" onPress={() => pickAndParse('backup')} />
        </Card>

        {pasteOpen ? (
          <Card>
            <Field
              label="Pasted schedule text"
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              placeholder={'CMSC216 Intro to Computer Systems\nMWF 10:00-10:50\nIRB 0324\n…'}
            />
            <Row>
              <View style={{ flex: 1 }}>
                <Field label="Semester start" value={pasteSemStart} onChangeText={setPasteSemStart} placeholder="2026-08-31" autoCapitalize="none" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Semester end" value={pasteSemEnd} onChangeText={setPasteSemEnd} placeholder="2026-12-14" autoCapitalize="none" />
              </View>
            </Row>
            <Button label="Parse pasted text" onPress={parsePasted} disabled={!pasteText.trim()} />
          </Card>
        ) : null}

        {warnings.length > 0 ? (
          <Card style={{ borderColor: c.warning, borderWidth: 1 }}>
            <Subtitle>Heads up</Subtitle>
            {warnings.map((w, i) => (
              <Body key={i} secondary style={{ fontSize: 13, marginBottom: 4 }}>
                ⚠ {w}
              </Body>
            ))}
          </Card>
        ) : null}

        {drafts.length > 0 ? (
          <>
            <Subtitle>Preview — {drafts.length} course(s) found</Subtitle>
            {drafts.map((d, i) => (
              <Card key={i} style={{ paddingVertical: 12 }}>
                <Body style={{ fontWeight: '700' }}>
                  {d.code || '(no code)'} · {d.name}
                </Body>
                {d.patterns.map((p, pi) => (
                  <Body key={pi} secondary>
                    {MEETING_COMPONENT_LABEL[p.label]}: {p.meetingDays.map((day) => WEEKDAY_SHORT[day]).join('')} ·{' '}
                    {p.startTime}–{p.endTime} · {[p.building, p.room].filter(Boolean).join(' ') || 'no location'}
                  </Body>
                ))}
                <Body secondary style={{ fontSize: 13 }}>
                  {d.semesterStart} → {d.semesterEnd}
                </Body>
              </Card>
            ))}
            {events.length > 0 ? (
              <Body secondary style={{ marginBottom: 8 }}>
                Plus {events.length} one-off event(s): {events.slice(0, 3).map((e) => e.title).join(', ')}
                {events.length > 3 ? '…' : ''}
              </Body>
            ) : null}
            <Button label={`Import ${drafts.length} course(s)`} onPress={confirmImport} />
            <Button label="Discard" kind="ghost" onPress={reset} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
