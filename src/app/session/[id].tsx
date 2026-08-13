/**
 * Session detail: a timestamped notes log for one specific class meeting.
 * Notes are plain text with a wall-clock timestamp — jot them live during
 * class or add them right after; the log is just a running list, oldest
 * first, so it reads like a timeline of the period.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  Row,
  Screen,
  Subtitle,
  Title,
} from '@/components/ui';
import { coursesRepo, eventsRepo, notesRepo, sessionsRepo } from '@/db/repo';
import { makeId } from '@/lib/ids';
import { detectScheduleHint, type NoteScheduleHint } from '@/lib/noteSchedule';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import type { ClassNote, ClassSession, Course } from '@/lib/types';
import { MEETING_COMPONENT_LABEL } from '@/lib/types';
import {
  copyNotePhotoIntoSandbox,
  deleteSandboxFile,
  pickDocument,
  validateImportedImage,
} from '@/services/files';
import { autoCropNotePhoto } from '@/services/notePhoto';
import { useApp } from '@/state/AppContext';

interface DraftPhoto {
  uri: string;
  mode: 'raw' | 'cropped';
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, version, bump } = useApp();
  const [session, setSession] = useState<ClassSession | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [notes, setNotes] = useState<ClassNote[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<DraftPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pendingHint, setPendingHint] = useState<NoteScheduleHint | null>(null);
  const [scheduleAdded, setScheduleAdded] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db || !id) return;
        const s = await sessionsRepo.byId(db, id);
        setSession(s);
        if (s) {
          setCourse(await coursesRepo.byId(db, s.courseId));
          setNotes(await notesRepo.forSession(db, s.id));
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, id, version]),
  );

  if (!session || !course) return <Loading />;

  const addNote = async () => {
    if (!db || (!draft.trim() && !photo)) return;
    try {
      const now = new Date();
      const text = draft.trim();
      const note: ClassNote = {
        id: makeId(),
        sessionId: session.id,
        courseId: course.id,
        timestamp: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        text,
        createdAt: now.toISOString(),
        photoUri: photo?.uri,
        photoMode: photo?.mode,
      };
      await notesRepo.insert(db, note);
      setDraft('');
      setPhoto(null);
      setNotes(await notesRepo.forSession(db, session.id));
      bump();
      setPendingHint(text ? detectScheduleHint(text, session.date) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeNote = async (noteId: string) => {
    if (!db) return;
    const note = notes.find((n) => n.id === noteId);
    deleteSandboxFile(note?.photoUri);
    await notesRepo.remove(db, noteId);
    setNotes(await notesRepo.forSession(db, session.id));
    bump();
  };

  const pickPhoto = async (mode: 'raw' | 'cropped') => {
    setError(null);
    try {
      const picked = await pickDocument(['image/*']);
      if (!picked) return;
      const invalid = validateImportedImage(picked.name, picked.size);
      if (invalid) {
        setError(invalid);
        return;
      }
      if (mode === 'raw') {
        setPhoto({ uri: copyNotePhotoIntoSandbox(picked), mode });
        return;
      }
      setPhotoBusy(true);
      const result = await autoCropNotePhoto(picked.uri);
      const uri = copyNotePhotoIntoSandbox({
        uri: result.uri,
        name: picked.name,
        mimeType: picked.mimeType,
        size: null,
      });
      setPhoto({ uri, mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const clearDraftPhoto = () => {
    deleteSandboxFile(photo?.uri);
    setPhoto(null);
  };

  const applyScheduleHint = async () => {
    if (!db || !pendingHint) return;
    const title = `${course.code} ${pendingHint.kind === 'exam' ? 'exam' : 'deadline'}`;
    await eventsRepo.insertMany(db, [
      { title, date: pendingHint.dateISO, time: null, kind: pendingHint.kind },
    ]);
    bump();
    setPendingHint(null);
    setScheduleAdded(`Added "${title}" on ${formatDateHuman(pendingHint.dateISO)} to your schedule.`);
  };

  const where = [session.overrideBuilding ?? session.building, session.overrideRoom ?? session.room]
    .filter(Boolean)
    .join(' ');

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Title>
          {course.code} · {MEETING_COMPONENT_LABEL[session.patternLabel]}
        </Title>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>
              {formatDateHuman(session.date)} · {formatTime12(session.startTime)}–{formatTime12(session.endTime)}
            </Body>
            <Badge label={session.status} />
          </Row>
          <Body secondary>{where || 'Location not set'}</Body>
          {session.status === 'scheduled' || session.status === 'moved' ? (
            <Button
              label="Can't make it"
              kind="ghost"
              compact
              onPress={() => router.push(`/absence/${session.id}`)}
            />
          ) : null}
        </Card>

        {error ? <ErrorBox message={error} /> : null}

        <Subtitle>Class notes</Subtitle>
        <Card>
          <Field
            label="Add a note"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="What's happening right now in class…"
          />
          {photo ? (
            <View style={{ marginBottom: 10 }}>
              <View style={{ width: '100%', height: 160, borderRadius: 8, overflow: 'hidden' }}>
                <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              </View>
              <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                <Badge label={photo.mode === 'raw' ? 'Raw' : 'Cropped'} />
                <Button label="Remove photo" icon="close" kind="ghost" compact onPress={clearDraftPhoto} />
              </Row>
            </View>
          ) : null}
          <Row>
            <View style={{ flex: 1 }}>
              <Button
                label={photoBusy ? 'Processing…' : 'Raw photo'}
                icon="image-outline"
                kind="secondary"
                compact
                disabled={photoBusy || photo != null}
                onPress={() => pickPhoto('raw')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={photoBusy ? 'Processing…' : 'Cropped photo'}
                icon="crop-outline"
                kind="secondary"
                compact
                disabled={photoBusy || photo != null}
                onPress={() => pickPhoto('cropped')}
              />
            </View>
          </Row>
          <Body secondary style={{ fontSize: 12, marginBottom: 8 }}>
            Photo of the board or a notebook page. &quot;Cropped&quot; auto-trims the margins and
            straightens orientation, on-device.
          </Body>
          <Button label="Add note" onPress={addNote} disabled={!draft.trim() && !photo} />
        </Card>

        {pendingHint ? (
          <Card>
            <Badge label={pendingHint.kind === 'exam' ? 'Exam detected' : 'Deadline detected'} tone="warning" />
            <Body style={{ marginTop: 6 }}>
              Add {course.code} {pendingHint.kind} on {formatDateHuman(pendingHint.dateISO)} to your
              schedule?
            </Body>
            <Body secondary style={{ fontSize: 13, marginTop: 4 }}>
              &quot;{pendingHint.evidence}&quot;
            </Body>
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="Add to schedule" compact onPress={applyScheduleHint} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Dismiss" kind="ghost" compact onPress={() => setPendingHint(null)} />
              </View>
            </Row>
          </Card>
        ) : null}
        {scheduleAdded ? (
          <Card>
            <Badge label="Added" tone="success" />
            <Body style={{ marginTop: 6 }}>{scheduleAdded}</Body>
          </Card>
        ) : null}

        {notes.length === 0 ? (
          <Body secondary style={{ textAlign: 'center', marginTop: 8 }}>
            No notes yet for this class period.
          </Body>
        ) : (
          notes.map((n) => (
            <Card key={n.id} style={{ paddingVertical: 10 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Body secondary style={{ fontSize: 12, minWidth: 56 }}>
                  {n.timestamp}
                </Body>
                <Body style={{ flex: 1 }}>{n.text}</Body>
                <Button label="Remove" icon="trash-outline" kind="ghost" compact onPress={() => removeNote(n.id)} />
              </Row>
              {n.photoUri ? (
                <View style={{ width: '100%', height: 180, borderRadius: 8, overflow: 'hidden', marginTop: 8 }}>
                  <Image source={{ uri: n.photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                </View>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
