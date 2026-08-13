/**
 * Import hub. Priority order: scan a screenshot (OCR, on-device) → paste
 * text → calendar/CSV file → restore backup. Scans finish in a popup that
 * asks which semester it is (summer additionally asks which session — only
 * when Summer is explicitly chosen) and imports everything in one tap.
 */

import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  FONT,
  Row,
  Screen,
  Subtitle,
  TextLink,
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
import { defaultSemesterId, SEMESTER_PRESETS } from '@/lib/semesters';
import { generateSessions } from '@/lib/sessions';
import type { Course, MeetingPattern } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { pickDocument, readTextFile, validateImportedFile } from '@/services/files';
import { OCR_AVAILABLE, ocrImage } from '@/services/ocr';
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
  const [done, setDone] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Semester selection (shared by the scan popup and the paste flow).
  const [semesterId, setSemesterId] = useState<string>(defaultSemesterId(new Date()));
  const [summerSessionId, setSummerSessionId] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Scan-result popup state.
  const [scanModal, setScanModal] = useState<{ codes: string[]; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const resolveSemesterDates = (): { start: string; end: string } | null => {
    if (semesterId === 'custom') {
      const start = normalizeDate(customStart);
      const end = normalizeDate(customEnd);
      return start && end && end > start ? { start, end } : null;
    }
    const preset = SEMESTER_PRESETS.find((s) => s.id === semesterId);
    if (!preset) return null;
    if (preset.sessions?.length) {
      const session = preset.sessions.find((s) => s.id === summerSessionId);
      return session ? { start: session.start, end: session.end } : null;
    }
    return { start: preset.start, end: preset.end };
  };

  const reset = () => {
    setError(null);
    setWarnings([]);
    setDrafts([]);
    setEvents([]);
    setDone(null);
  };

  const pickAndParseFile = async () => {
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
      const lower = picked.name.toLowerCase();
      if (lower.endsWith('.ics')) {
        const result = parseIcs(text);
        setDrafts(result.courses);
        setEvents(result.events);
        setWarnings(result.warnings);
        if (result.courses.length === 0 && result.events.length === 0 && result.warnings.length === 0) {
          setError('Nothing importable was found in that calendar.');
        }
      } else if (lower.endsWith('.csv')) {
        const result = parseCsvSchedule(text);
        setDrafts(result.courses);
        setWarnings(result.warnings);
      } else if (lower.endsWith('.json')) {
        await restoreBackup(text);
      } else {
        setError('Pick a .ics calendar, .csv spreadsheet, or .json backup file.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreBackupFlow = async () => {
    reset();
    try {
      const picked = await pickDocument(['application/json', '*/*']);
      if (!picked) return;
      const text = await readTextFile(picked.uri);
      await restoreBackup(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const scanScreenshot = async () => {
    reset();
    try {
      const picked = await pickDocument(['image/*']);
      if (!picked) return;
      setOcrProgress(0);
      const result = await ocrImage(picked.uri, setOcrProgress);
      setOcrProgress(null);
      if (!result.ok) {
        setError(result.error ?? 'Could not read that screenshot.');
        return;
      }
      setPasteText(result.text);
      const found = parseScheduleText(result.text);
      if (found.courses.length > 0) {
        setModalError(null);
        setScanModal({ codes: found.courses.map((co) => co.code), text: result.text });
      } else {
        setPasteOpen(true);
        setWarnings([
          'Screenshot was read, but no course codes were recognized. Check the text below for OCR mistakes, fix them, and parse again.',
        ]);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      }
    } catch (e) {
      setOcrProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const buildDraftsFrom = (text: string, dates: { start: string; end: string }) => {
    const result = parseScheduleText(text);
    return {
      drafts: result.courses.map((co) => ({ ...co, semesterStart: dates.start, semesterEnd: dates.end })),
      warnings: [...result.warnings, ...result.partial.map((p) => `Needs manual entry: ${p.split('\n')[0]}`)],
    };
  };

  const runParse = (text: string) => {
    reset();
    const dates = resolveSemesterDates();
    if (!dates) {
      setError(
        semesterId === 'custom'
          ? 'Enter valid custom start and end dates (like 2026-08-31).'
          : 'Pick which summer session this is first.',
      );
      return;
    }
    const built = buildDraftsFrom(text, dates);
    setWarnings(built.warnings);
    setDrafts(built.drafts);
  };

  const importDrafts = async (draftsArg: Draft[], eventsArg: CalendarEventDraft[]) => {
    if (!db) return 0;
    let imported = 0;
    for (const draft of draftsArg) {
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
    if (eventsArg.length > 0) await eventsRepo.insertMany(db, eventsArg);
    bump();
    await rescheduleNotifications();
    return imported;
  };

  /** One-tap import from the scan popup: parse + import everything. */
  const importFromScan = async () => {
    if (!scanModal) return;
    const dates = resolveSemesterDates();
    if (!dates) {
      setModalError(
        semesterId === 'custom'
          ? 'Enter valid custom start and end dates.'
          : 'Pick which summer session this is.',
      );
      return;
    }
    setImporting(true);
    try {
      const built = buildDraftsFrom(scanModal.text, dates);
      const count = await importDrafts(built.drafts, []);
      setScanModal(null);
      reset();
      setWarnings(built.warnings);
      setDone(`Imported ${count} course${count === 1 ? '' : 's'}. Reminders re-scheduled.`);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    try {
      const count = await importDrafts(drafts, events);
      setDrafts([]);
      setEvents([]);
      setDone(
        `Imported ${count} course${count === 1 ? '' : 's'}${events.length ? ` and ${events.length} calendar event(s)` : ''}. Reminders re-scheduled.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

  const semesterPicker = (
    <View>
      <Body secondary style={{ fontSize: 13, marginBottom: 6 }}>
        Which semester is this?
      </Body>
      <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
        {SEMESTER_PRESETS.map((s) => (
          <View key={s.id} style={{ minWidth: 105, flex: 1 }}>
            <Button
              label={s.label}
              compact
              kind={semesterId === s.id ? 'primary' : 'secondary'}
              onPress={() => {
                setSemesterId(s.id);
                setSummerSessionId(null);
              }}
            />
          </View>
        ))}
        <View style={{ minWidth: 105, flex: 1 }}>
          <Button
            label="Custom dates"
            compact
            kind={semesterId === 'custom' ? 'primary' : 'secondary'}
            onPress={() => setSemesterId('custom')}
          />
        </View>
      </Row>
      {SEMESTER_PRESETS.find((s) => s.id === semesterId)?.sessions ? (
        <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
          {SEMESTER_PRESETS.find((s) => s.id === semesterId)!.sessions!.map((session) => (
            <View key={session.id} style={{ minWidth: 150, flex: 1 }}>
              <Button
                label={session.label}
                compact
                kind={summerSessionId === session.id ? 'primary' : 'secondary'}
                onPress={() => setSummerSessionId(session.id)}
              />
            </View>
          ))}
        </Row>
      ) : null}
      {semesterId === 'custom' ? (
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Start" value={customStart} onChangeText={setCustomStart} placeholder="2026-08-31" autoCapitalize="none" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="End" value={customEnd} onChangeText={setCustomEnd} placeholder="2026-12-11" autoCapitalize="none" />
          </View>
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        {error ? <ErrorBox message={error} /> : null}
        {done ? (
          <Card>
            <Badge label="Success" tone="success" />
            <Body style={{ marginTop: 6 }}>{done}</Body>
            <Button label="Back to schedule" onPress={() => router.back()} />
          </Card>
        ) : null}

        {OCR_AVAILABLE ? (
          <Card>
            <Button
              label={ocrProgress != null ? `Reading screenshot… ${ocrProgress}%` : 'Scan a schedule screenshot'}
              icon="scan-outline"
              disabled={ocrProgress != null}
              onPress={scanScreenshot}
            />
            <Body secondary style={{ fontSize: 13 }}>
              Testudo screenshot in, courses out — read entirely on your device.
            </Body>
          </Card>
        ) : null}

        <Card>
          <Button
            label="Paste schedule text"
            kind={OCR_AVAILABLE ? 'secondary' : 'primary'}
            icon="clipboard-outline"
            onPress={() => setPasteOpen(!pasteOpen)}
          />
          <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
            Long-press a screenshot → copy text (Live Text / Lens) → paste here.
          </Body>
          <Button label="Calendar or CSV file" kind="secondary" icon="document-outline" onPress={pickAndParseFile} />
          <Body secondary style={{ fontSize: 13 }}>
            .ics from Testudo/Google Calendar, or a spreadsheet export.
          </Body>
        </Card>

        {pasteOpen ? (
          <Card>
            <Field
              label="Schedule text"
              value={pasteText}
              onChangeText={setPasteText}
              multiline
              placeholder={'COMM 107 (9601)\nLec TTh 12:30pm - 1:45pm EST SKN 1112\n…'}
            />
            {semesterPicker}
            <Button label="Parse text" onPress={() => runParse(pasteText)} disabled={!pasteText.trim()} />
          </Card>
        ) : null}

        {warnings.length > 0 ? (
          <Card style={{ borderColor: c.warning, borderWidth: 1 }}>
            <Subtitle>Heads up</Subtitle>
            {warnings.map((w, i) => (
              <Body key={i} secondary style={{ fontSize: 13, marginBottom: 4 }}>
                {w}
              </Body>
            ))}
          </Card>
        ) : null}

        {drafts.length > 0 ? (
          <>
            <Subtitle>Preview — {drafts.length} course(s) found</Subtitle>
            {drafts.map((d, i) => (
              <Card key={i} style={{ paddingVertical: 12 }}>
                <Body style={{ fontFamily: FONT.bold }}>
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

        <Row style={{ justifyContent: 'center', marginTop: 8 }}>
          <TextLink label="Restore JSON backup" icon="archive-outline" onPress={restoreBackupFlow} />
        </Row>
      </ScrollView>

      {/* Post-scan popup: pick the semester, import everything in one tap. */}
      <Modal visible={scanModal != null} transparent animationType="fade" onRequestClose={() => setScanModal(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: 20,
          }}>
          <Card style={{ maxHeight: '85%' }}>
            <ScrollView>
              <Badge label="Screenshot read" tone="success" />
              <Body style={{ fontFamily: FONT.bold, fontSize: 17, marginTop: 8 }}>
                Found {scanModal?.codes.length} course{scanModal?.codes.length === 1 ? '' : 's'}
              </Body>
              <Body secondary style={{ marginBottom: 10 }}>
                {scanModal?.codes.join(', ')}
              </Body>
              {modalError ? <ErrorBox message={modalError} /> : null}
              {semesterPicker}
              <Button
                label={importing ? 'Importing…' : `Import all ${scanModal?.codes.length ?? 0}`}
                icon="checkmark"
                disabled={importing}
                onPress={importFromScan}
              />
              <Row>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Review text first"
                    kind="secondary"
                    compact
                    onPress={() => {
                      setScanModal(null);
                      setPasteOpen(true);
                      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" kind="ghost" compact onPress={() => setScanModal(null)} />
                </View>
              </Row>
            </ScrollView>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
