/**
 * Import hub. Priority order: scan a screenshot (OCR, on-device) → paste
 * text → calendar/CSV file → restore backup. Scans finish in a popup that
 * asks which semester it is (summer additionally asks which session — only
 * when Summer is explicitly chosen) and imports everything in one tap.
 */

import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  FONT,
  Icon,
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
  planetTerpCacheRepo,
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
import { pickDocument, pickDocuments, readTextFile, validateImportedFile } from '@/services/files';
import { OCR_AVAILABLE, ocrImage } from '@/services/ocr';
import { fetchEnrichment } from '@/services/planetterp';
import { fetchSectionProfessor } from '@/services/umdio';
import { enableWebPush, isPushSupported } from '@/services/webpush';
import { useApp } from '@/state/AppContext';

type Draft = CourseDraft & { attendancePolicy?: string; walkingBufferMin?: number };

export default function ImportScreen() {
  const { db, bump, rescheduleNotifications, settings, saveSettings } = useApp();
  const c = useColors();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [events, setEvents] = useState<CalendarEventDraft[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // Post-import nudge: offer push reminders right when they're most useful.
  const [notifModal, setNotifModal] = useState(false);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  const maybeOfferNotifications = () => {
    if (isPushSupported() && !settings.webPushEnabled) setNotifModal(true);
  };

  const acceptNotifications = async () => {
    setNotifBusy(true);
    setNotifError(null);
    try {
      const result = await enableWebPush();
      if (!result.ok) {
        setNotifError(result.error);
        return;
      }
      await saveSettings({ ...settings, webPushEnabled: true });
      await rescheduleNotifications(); // syncs the fresh schedule to the relay
      setNotifModal(false);
    } finally {
      setNotifBusy(false);
    }
  };
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
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [ptFetch, setPtFetch] = useState(true);

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
      const picked = await pickDocuments(['image/*'], 3);
      if (picked.length === 0) return;
      const texts: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        const prefix = picked.length > 1 ? `Screenshot ${i + 1}/${picked.length}: ` : '';
        setOcrProgress(`${prefix}0%`);
        const result = await ocrImage(picked[i].uri, (pct) => setOcrProgress(`${prefix}${pct}%`));
        if (!result.ok) {
          setOcrProgress(null);
          setError(result.error ?? 'Could not read that screenshot.');
          return;
        }
        texts.push(result.text);
      }
      setOcrProgress(null);
      const combined = texts.join('\n\n');
      setPasteText(combined);
      const found = parseScheduleText(combined);
      if (found.courses.length > 0) {
        setModalError(null);
        setScanModal({ codes: found.courses.map((co) => co.code), text: combined });
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
    if (!db) return [] as { course: Course; section?: string }[];
    const imported: { course: Course; section?: string }[] = [];
    for (const draft of draftsArg) {
      const course: Course = {
        id: makeId(),
        code: draft.code || `COURSE${imported.length + 1}`,
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
      imported.push({ course, section: draft.section });
    }
    if (eventsArg.length > 0) await eventsRepo.insertMany(db, eventsArg);
    bump();
    await rescheduleNotifications();
    return imported;
  };

  /**
   * Enrich freshly imported courses: resolve the professor from the scanned
   * section number (registrar Schedule of Classes; umd.io fallback), then
   * fetch PlanetTerp so titles, ratings, and attendance hints target that
   * professor. Failures are per-course and non-fatal.
   */
  const enrichImported = async (imported: { course: Course; section?: string }[]) => {
    if (!db) return 0;
    let enriched = 0;
    for (let i = 0; i < imported.length; i++) {
      let { course } = imported[i];
      const { section } = imported[i];
      setImportStatus(`Looking up ${course.code}… ${i + 1}/${imported.length}`);
      if (!course.professor && section) {
        const prof = await fetchSectionProfessor(course.code, course.semesterStart, section);
        if (prof) {
          course = { ...course, professor: prof };
          await coursesRepo.upsert(db, course);
        }
      }
      const result = await fetchEnrichment(course.code, course.professor, course.semesterStart);
      if (!result.ok) continue;
      await planetTerpCacheRepo.set(db, course.code, result.value);
      if (result.value.title && course.name.trim() === course.code) {
        await coursesRepo.upsert(db, { ...course, name: result.value.title });
      }
      enriched++;
    }
    if (enriched > 0) bump();
    return enriched;
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
    setImportStatus('Importing…');
    try {
      const built = buildDraftsFrom(scanModal.text, dates);
      const imported = await importDrafts(built.drafts, []);
      let ptNote = '';
      if (ptFetch && imported.length > 0) {
        const enriched = await enrichImported(imported);
        ptNote =
          enriched > 0
            ? ` Course names and PlanetTerp info added for ${enriched} of them.`
            : ' PlanetTerp lookup was unavailable — you can fetch per course later.';
      }
      setScanModal(null);
      reset();
      setWarnings(built.warnings);
      setDone(`Imported ${imported.length} course${imported.length === 1 ? '' : 's'}.${ptNote}`);
      if (imported.length > 0) maybeOfferNotifications();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setImportStatus(null);
    }
  };

  const confirmImport = async () => {
    try {
      const imported = await importDrafts(drafts, events);
      setDrafts([]);
      setEvents([]);
      setDone(
        `Imported ${imported.length} course${imported.length === 1 ? '' : 's'}${events.length ? ` and ${events.length} calendar event(s)` : ''}. Reminders re-scheduled.`,
      );
      if (imported.length > 0) maybeOfferNotifications();
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
              label={ocrProgress != null ? `Reading… ${ocrProgress}` : 'Scan schedule screenshots'}
              icon="scan-outline"
              disabled={ocrProgress != null}
              onPress={() => setTutorialOpen(true)}
            />
            <Body secondary style={{ fontSize: 13 }}>
              Up to 3 Testudo screenshots in, courses out — read entirely on your device.
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

      {/* Post-import nudge: enable push reminders while it's top of mind. */}
      <Modal visible={notifModal} transparent animationType="fade" onRequestClose={() => setNotifModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 }}>
          <Card>
            <Row style={{ gap: 8, marginBottom: 4 }}>
              <Icon name="notifications-outline" size={20} color={c.accent} />
              <Body style={{ fontFamily: FONT.bold, fontSize: 17 }}>Get class reminders?</Body>
            </Row>
            <Body secondary style={{ fontSize: 13.5, lineHeight: 19, marginBottom: 8 }}>
              A heads-up before each class and a &ldquo;leave now&rdquo; timed to your walk — even
              while the app is closed. Only your pending reminders are stored, each deleted once
              sent. You can turn this off anytime in Settings.
            </Body>
            {notifError ? <ErrorBox message={notifError} /> : null}
            <Button
              label={notifBusy ? 'Enabling…' : 'Enable reminders'}
              icon="notifications-outline"
              disabled={notifBusy}
              onPress={acceptNotifications}
            />
            <Button label="Not now" kind="ghost" onPress={() => setNotifModal(false)} />
          </Card>
        </View>
      </Modal>

      {/* Pre-scan tutorial: what a good screenshot looks like. */}
      <Modal visible={tutorialOpen} transparent animationType="fade" onRequestClose={() => setTutorialOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 }}>
          <Card style={{ maxHeight: '88%' }}>
            <ScrollView>
              <Body style={{ fontFamily: FONT.bold, fontSize: 17 }}>Screenshot your Testudo schedule</Body>
              <Body secondary style={{ fontSize: 13.5, lineHeight: 19, marginTop: 4 }}>
                On Testudo → <Body style={{ fontFamily: FONT.bold, fontSize: 13.5 }}>Student Schedule</Body>,
                tap the arrow on each course (reveals its name + professor), then screenshot the list —
                up to 3 screenshots, selected together:
              </Body>
              {/* RN-web ignores aspectRatio on Image (falls back to the file's
                  intrinsic height, leaving letterbox gaps) — size a View and
                  let the image fill it. */}
              <View style={{ width: '100%', aspectRatio: 720 / 600, marginVertical: 8 }}>
                <Image
                  source={require('../../assets/scan-example.png')}
                  accessibilityLabel="Example Testudo schedule screenshot with each course expanded"
                  style={{ width: '100%', height: '100%', borderRadius: 8 }}
                  resizeMode="contain"
                />
              </View>
              <Button label="Choose screenshots" icon="images-outline" onPress={() => { setTutorialOpen(false); scanScreenshot(); }} />
              <Button label="Cancel" kind="ghost" onPress={() => setTutorialOpen(false)} />
            </ScrollView>
          </Card>
        </View>
      </Modal>

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
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ptFetch }}
                onPress={() => setPtFetch(!ptFetch)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  paddingVertical: 8,
                  opacity: pressed ? 0.6 : 1,
                })}>
                <Icon name={ptFetch ? 'checkbox' : 'square-outline'} size={20} color={ptFetch ? c.accent : undefined} />
                <Body secondary style={{ flex: 1, fontSize: 13.5 }}>
                  Also look up each section&apos;s professor (Testudo Schedule of Classes) and
                  fetch PlanetTerp info — real course names, ratings, and what reviews say about
                  attendance.
                </Body>
              </Pressable>
              <Button
                label={importStatus ?? `Import all ${scanModal?.codes.length ?? 0}`}
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
