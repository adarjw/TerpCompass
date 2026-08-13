/** Course detail: info, attendance, resources (attach/extract), absences. */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
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
import {
  absencesRepo,
  coursesRepo,
  locationsRepo,
  patternsRepo,
  resourcesRepo,
} from '@/db/repo';
import { findBuilding } from '@/lib/campus';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import type { Absence, CampusLocation, Course, MeetingPattern, Resource, ResourceKind } from '@/lib/types';
import { MEETING_COMPONENT_LABEL, WEEKDAY_SHORT } from '@/lib/types';
import { bestMapUrl } from '@/lib/walking';
import {
  attachFileResource,
  attachTextResource,
  deleteSandboxFile,
  pickDocument,
} from '@/services/files';
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

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db || !id) return;
        setCourse(await coursesRepo.byId(db, id));
        setPatterns(await patternsRepo.forCourse(db, id));
        setBuildings(await locationsRepo.all(db));
        setResources(await resourcesRepo.forCourse(db, id));
        setAbsences(await absencesRepo.forCourse(db, id));
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, id, version]),
  );

  if (!course) return <Loading />;

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
      await attachTextResource(db, course.id, pasteMode, pasteTitle || 'Pasted text', pasteText, semesterYear);
      setPasteMode(null);
      setPasteTitle('');
      setPasteText('');
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeResource = (res: Resource) => {
    Alert.alert('Remove resource?', res.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!db) return;
          await resourcesRepo.remove(db, res.id);
          deleteSandboxFile(res.fileUri);
          bump();
        },
      },
    ]);
  };

  const removeCourse = () => {
    Alert.alert('Delete this course?', 'All sessions, absences, resources, and plans for it will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete course',
        style: 'destructive',
        onPress: async () => {
          if (!db) return;
          await coursesRepo.remove(db, course.id);
          bump();
          await rescheduleNotifications();
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen>
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
                  onPress={() => Linking.openURL(bestMapUrl(loc, where || course.code, Platform.OS === 'ios'))}
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

        <Subtitle>Resources</Subtitle>
        {error ? <ErrorBox message={error} /> : null}
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
