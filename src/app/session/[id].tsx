/**
 * Session detail: a timestamped notes log for one specific class meeting.
 * Notes are plain text with a wall-clock timestamp — jot them live during
 * class or add them right after; the log is just a running list, oldest
 * first, so it reads like a timeline of the period.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';

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
import { coursesRepo, notesRepo, sessionsRepo } from '@/db/repo';
import { makeId } from '@/lib/ids';
import { formatDateHuman, formatTime12 } from '@/lib/time';
import type { ClassNote, ClassSession, Course } from '@/lib/types';
import { MEETING_COMPONENT_LABEL } from '@/lib/types';
import { useApp } from '@/state/AppContext';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, version, bump } = useApp();
  const [session, setSession] = useState<ClassSession | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [notes, setNotes] = useState<ClassNote[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    if (!db || !draft.trim()) return;
    try {
      const now = new Date();
      const note: ClassNote = {
        id: makeId(),
        sessionId: session.id,
        courseId: course.id,
        timestamp: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        text: draft.trim(),
        createdAt: now.toISOString(),
      };
      await notesRepo.insert(db, note);
      setDraft('');
      setNotes(await notesRepo.forSession(db, session.id));
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeNote = async (noteId: string) => {
    if (!db) return;
    await notesRepo.remove(db, noteId);
    setNotes(await notesRepo.forSession(db, session.id));
    bump();
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
            <Badge label={session.status.toUpperCase()} />
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
          <Button label="Add note" onPress={addNote} disabled={!draft.trim()} />
        </Card>

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
                <Button label="✕" kind="ghost" compact onPress={() => removeNote(n.id)} />
              </Row>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
