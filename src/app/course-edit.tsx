/**
 * Manual class entry / editing. A course has one or more meeting patterns
 * (lecture, discussion, lab, ...) — regenerates sessions for all of them
 * on save, preserving history for sessions already marked attended/absent/
 * canceled/moved.
 */

import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Row,
  Screen,
  Subtitle,
} from '@/components/ui';
import { coursesRepo, patternsRepo, sessionsRepo } from '@/db/repo';
import { normalizeDate, normalizeTime } from '@/lib/csv';
import { makeId } from '@/lib/ids';
import { generateSessions } from '@/lib/sessions';
import { parseTime } from '@/lib/time';
import type { Course, MeetingComponent, Weekday } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { useApp } from '@/state/AppContext';

const COMPONENT_OPTIONS: MeetingComponent[] = ['lecture', 'discussion', 'lab', 'seminar', 'studio'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidEmail(value: string): boolean {
  return value.trim() !== '' && !EMAIL_RE.test(value.trim());
}

interface PatternForm {
  key: string;
  label: MeetingComponent;
  building: string;
  room: string;
  days: Weekday[];
  start: string;
  end: string;
}

function blankPattern(label: MeetingComponent = 'lecture'): PatternForm {
  return { key: makeId(), label, building: '', room: '', days: [], start: '', end: '' };
}

export default function CourseEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { db, bump, rescheduleNotifications } = useApp();
  const [existing, setExisting] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [professor, setProfessor] = useState('');
  const [professorEmail, setProfessorEmail] = useState('');
  const [taEmails, setTaEmails] = useState('');
  const [patterns, setPatterns] = useState<PatternForm[]>([blankPattern()]);
  const [semStart, setSemStart] = useState('');
  const [semEnd, setSemEnd] = useState('');
  const [policy, setPolicy] = useState('');
  const [buffer, setBuffer] = useState('');

  useEffect(() => {
    (async () => {
      if (!db || !id) return;
      const c = await coursesRepo.byId(db, id);
      if (c) {
        setExisting(c);
        setCode(c.code);
        setName(c.name);
        setProfessor(c.professor);
        setProfessorEmail(c.professorEmail ?? '');
        setTaEmails(c.taEmails ?? '');
        setSemStart(c.semesterStart);
        setSemEnd(c.semesterEnd);
        setPolicy(c.attendancePolicy ?? '');
        setBuffer(c.walkingBufferMin?.toString() ?? '');
        const loaded = await patternsRepo.forCourse(db, id);
        if (loaded.length > 0) {
          setPatterns(
            loaded.map((p) => ({
              key: makeId(),
              label: p.label,
              building: p.building,
              room: p.room,
              days: p.meetingDays,
              start: p.startTime,
              end: p.endTime,
            })),
          );
        }
      }
    })();
  }, [db, id]);

  const updatePattern = (key: string, patch: Partial<PatternForm>) =>
    setPatterns((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const toggleDay = (key: string, d: Weekday) =>
    setPatterns((prev) =>
      prev.map((p) =>
        p.key === key
          ? { ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort() }
          : p,
      ),
    );

  const addPattern = () => {
    // Suggest the next component that isn't already used (Lecture -> Discussion -> Lab -> ...).
    const used = new Set(patterns.map((p) => p.label));
    const next = COMPONENT_OPTIONS.find((c) => !used.has(c)) ?? 'other';
    setPatterns((prev) => [...prev, blankPattern(next)]);
  };

  const removePattern = (key: string) =>
    setPatterns((prev) => (prev.length > 1 ? prev.filter((p) => p.key !== key) : prev));

  const save = async () => {
    if (!db) return;
    if (!code.trim()) return setError('Course code is required (e.g. CMSC131).');
    if (invalidEmail(professorEmail)) return setError("Professor email doesn't look valid.");
    const taList = taEmails.split(',').map((e) => e.trim()).filter(Boolean);
    if (taList.some(invalidEmail)) return setError("One of the TA emails doesn't look valid.");
    const semStartD = normalizeDate(semStart);
    const semEndD = normalizeDate(semEnd);
    if (!semStartD || !semEndD) return setError('Semester dates must look like 2026-08-31.');
    if (semEndD < semStartD) return setError('Semester end must be after semester start.');

    const bufferNum = buffer.trim() === '' ? undefined : Number(buffer);
    if (bufferNum !== undefined && (!Number.isFinite(bufferNum) || bufferNum < 0 || bufferNum > 120)) {
      return setError('Walking buffer should be 0–120 minutes.');
    }

    const resolved: { label: MeetingComponent; building: string; room: string; days: Weekday[]; start: string; end: string }[] = [];
    for (const p of patterns) {
      const startT = normalizeTime(p.start);
      const endT = normalizeTime(p.end);
      const componentName = MEETING_COMPONENT_LABEL[p.label];
      if (p.days.length === 0) return setError(`${componentName}: pick at least one meeting day.`);
      if (!startT || !endT) return setError(`${componentName}: times must look like 14:00 or 2:00 PM.`);
      if (parseTime(endT)! <= parseTime(startT)!) {
        return setError(`${componentName}: end time must be after start time.`);
      }
      resolved.push({ label: p.label, building: p.building.trim(), room: p.room.trim(), days: p.days, start: startT, end: endT });
    }

    const course: Course = {
      id: existing?.id ?? makeId(),
      code: code.trim().toUpperCase().replace(/\s+/g, ''),
      name: name.trim() || code.trim(),
      professor: professor.trim(),
      professorEmail: professorEmail.trim() || undefined,
      taEmails: taList.length > 0 ? taList.join(', ') : undefined,
      semesterStart: semStartD,
      semesterEnd: semEndD,
      attendancePolicy: policy.trim() || undefined,
      walkingBufferMin: bufferNum,
      color: existing?.color,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const patternRows = resolved.map((p) => ({
      id: makeId(),
      courseId: course.id,
      label: p.label,
      building: p.building,
      room: p.room,
      meetingDays: p.days,
      startTime: p.start,
      endTime: p.end,
    }));
    try {
      await coursesRepo.upsert(db, course);
      await patternsRepo.replaceForCourse(db, course.id, patternRows);
      const fresh = generateSessions(course, patternRows, makeId);
      await sessionsRepo.regenerate(db, course.id, fresh);
      bump();
      await rescheduleNotifications();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        {error ? <ErrorBox message={error} /> : null}
        <Card>
          <Field label="Course code *" value={code} onChangeText={setCode} placeholder="CMSC131" autoCapitalize="characters" />
          <Field label="Course name" value={name} onChangeText={setName} placeholder="Object-Oriented Programming I" />
          <Field label="Professor" value={professor} onChangeText={setProfessor} placeholder="Prof. Rivera" />
          <Field
            label="Professor email (optional — used for absence-notice drafts)"
            value={professorEmail}
            onChangeText={setProfessorEmail}
            placeholder="rivera@umd.edu"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field
            label="TA email(s), comma-separated (optional)"
            value={taEmails}
            onChangeText={setTaEmails}
            placeholder="ta1@umd.edu, ta2@umd.edu"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Semester start *" value={semStart} onChangeText={setSemStart} placeholder="2026-08-31" autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Semester end *" value={semEnd} onChangeText={setSemEnd} placeholder="2026-12-14" autoCapitalize="none" />
            </View>
          </Row>
          <Field
            label="Attendance policy (optional)"
            value={policy}
            onChangeText={setPolicy}
            multiline
            placeholder="e.g. Attendance is 10% of the grade; no make-ups."
          />
          <Field
            label="Extra walking buffer, minutes (optional)"
            value={buffer}
            onChangeText={setBuffer}
            keyboardType="number-pad"
            placeholder="5"
          />
        </Card>

        <Subtitle>Meeting times</Subtitle>
        <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
          Add one entry per way this course meets — e.g. a Lecture plus a separate Discussion or
          Lab in a different room/time.
        </Body>
        {patterns.map((p, i) => (
          <Card key={p.key}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Subtitle>Meeting {i + 1}</Subtitle>
              {patterns.length > 1 ? (
                <Button label="Remove" kind="ghost" compact onPress={() => removePattern(p.key)} />
              ) : null}
            </Row>
            <Row style={{ flexWrap: 'wrap', marginBottom: 10 }}>
              {COMPONENT_OPTIONS.map((opt) => (
                <View key={opt} style={{ minWidth: 90, flex: 1 }}>
                  <Button
                    label={MEETING_COMPONENT_LABEL[opt]}
                    compact
                    kind={p.label === opt ? 'primary' : 'secondary'}
                    onPress={() => updatePattern(p.key, { label: opt })}
                  />
                </View>
              ))}
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label="Building"
                  value={p.building}
                  onChangeText={(v) => updatePattern(p.key, { building: v })}
                  placeholder="IRB"
                  autoCapitalize="characters"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Room"
                  value={p.room}
                  onChangeText={(v) => updatePattern(p.key, { room: v })}
                  placeholder="0324"
                />
              </View>
            </Row>
            <Subtitle>Meeting days *</Subtitle>
            <Row style={{ marginBottom: 12 }}>
              {WEEKDAY_SHORT.map((label, d) => (
                <View key={label} style={{ flex: 1 }}>
                  <Button
                    label={label}
                    compact
                    kind={p.days.includes(d as Weekday) ? 'primary' : 'secondary'}
                    onPress={() => toggleDay(p.key, d as Weekday)}
                  />
                </View>
              ))}
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Field
                  label="Start time *"
                  value={p.start}
                  onChangeText={(v) => updatePattern(p.key, { start: v })}
                  placeholder="10:00"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="End time *"
                  value={p.end}
                  onChangeText={(v) => updatePattern(p.key, { end: v })}
                  placeholder="10:50"
                  autoCapitalize="none"
                />
              </View>
            </Row>
          </Card>
        ))}
        <Button label="Add another meeting (e.g. Discussion)" kind="secondary" onPress={addPattern} />

        <Body secondary style={{ fontSize: 13, marginTop: 8, marginBottom: 8 }}>
          Saving regenerates this course&apos;s class sessions. Sessions you already marked
          (attended/absent/canceled) are kept.
        </Body>
        <Button label={existing ? 'Save changes' : 'Add class'} onPress={save} />
      </ScrollView>
    </Screen>
  );
}
