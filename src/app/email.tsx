/**
 * Cancellation/announcement handling: paste email text or import a .eml
 * file, detect a possible schedule change, and always confirm before
 * touching any session.
 */

import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
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
  Title,
} from '@/components/ui';
import { coursesRepo, sessionsRepo } from '@/db/repo';
import { analyzeEmail, extractEmlBody, type EmailAnalysis } from '@/lib/email';
import { addDaysISO, toISODate } from '@/lib/time';
import type { ClassSession, Course } from '@/lib/types';
import { pickDocument, readTextFile, validateImportedFile } from '@/services/files';
import { useApp } from '@/state/AppContext';

function resolveDateToken(token: string | null, today: string): string | null {
  if (!token) return null;
  if (token === 'TODAY') return today;
  if (token === 'TOMORROW') return addDaysISO(today, 1);
  return token;
}

export default function EmailScreen() {
  const { db, bump, rescheduleNotifications } = useApp();
  const [courses, setCourses] = useState<Course[]>([]);
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState<EmailAnalysis | null>(null);
  const [matchSessions, setMatchSessions] = useState<ClassSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [manualCourseId, setManualCourseId] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db) return;
        setCourses(await coursesRepo.all(db));
      })();
    }, [db]),
  );

  const importEml = async () => {
    setError(null);
    try {
      const picked = await pickDocument(['message/rfc822', '*/*']);
      if (!picked) return;
      const invalid = validateImportedFile(picked.name, picked.size);
      if (invalid) return setError(invalid);
      const raw = await readTextFile(picked.uri);
      const { body } = extractEmlBody(raw);
      setText(body);
      runAnalysis(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runAnalysis = async (value: string) => {
    if (!db) return;
    setApplied(false);
    const today = toISODate(new Date());
    const result = analyzeEmail(value, new Date().getFullYear());
    setAnalysis(result);

    const dateISO = resolveDateToken(result.date, today);
    const course = result.courseCode
      ? courses.find((c) => c.code.toUpperCase() === result.courseCode)
      : null;
    setManualCourseId(course?.id ?? null);
    setManualDate(dateISO ?? '');

    if (course && dateISO) {
      const sessions = await sessionsRepo.forCourse(db, course.id);
      setMatchSessions(sessions.filter((s) => s.date === dateISO));
    } else {
      setMatchSessions([]);
    }
  };

  const apply = async () => {
    if (!db || !analysis || analysis.kind === 'none') return;
    const course = manualCourseId ? courses.find((c) => c.id === manualCourseId) : null;
    if (!course || !manualDate) {
      setError('Pick the course and date this email refers to before applying.');
      return;
    }
    const sessions = await sessionsRepo.forCourse(db, course.id);
    const target = sessions.find((s) => s.date === manualDate);
    if (!target) {
      setError(`No ${course.code} session found on ${manualDate}.`);
      return;
    }
    const statusMap = {
      canceled: 'canceled',
      remote: 'moved',
      room_changed: 'moved',
      moved: 'moved',
    } as const;
    const note =
      analysis.kind === 'remote'
        ? 'Remote/online (from email)'
        : analysis.kind === 'room_changed' || analysis.kind === 'moved'
          ? analysis.newLocation
            ? `Moved to ${analysis.newLocation} (from email)`
            : 'Location/time changed (from email)'
          : 'Canceled (from email)';
    await sessionsRepo.setStatus(
      db,
      target.id,
      statusMap[analysis.kind],
      note,
      analysis.kind === 'room_changed' && analysis.newLocation ? analysis.newLocation : undefined,
    );
    bump();
    await rescheduleNotifications();
    setApplied(true);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        <Title>Class change from email</Title>
        <Body secondary style={{ marginBottom: 12 }}>
          Paste the email text or import a .eml file. Nothing changes on your schedule until you
          confirm below.
        </Body>
        {error ? <ErrorBox message={error} /> : null}

        <Card>
          <Field
            label="Email text"
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Paste the email content here…"
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Analyze" onPress={() => runAnalysis(text)} disabled={!text.trim()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Import .eml file" kind="secondary" onPress={importEml} />
            </View>
          </Row>
        </Card>

        {analysis ? (
          <Card>
            <Subtitle>Detected</Subtitle>
            <Badge
              label={analysis.summary}
              tone={analysis.kind === 'none' ? 'neutral' : analysis.kind === 'canceled' ? 'danger' : 'warning'}
            />
            {analysis.evidence.map((e, i) => (
              <Body key={i} secondary style={{ fontSize: 13, marginTop: 6 }}>
                &quot;{e}&quot;
              </Body>
            ))}
            {analysis.kind !== 'none' ? (
              <>
                <Subtitle>Which class does this affect?</Subtitle>
                <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  {courses.map((c) => (
                    <View key={c.id} style={{ minWidth: 90 }}>
                      <Button
                        label={c.code}
                        compact
                        kind={manualCourseId === c.id ? 'primary' : 'secondary'}
                        onPress={() => setManualCourseId(c.id)}
                      />
                    </View>
                  ))}
                </Row>
                <Field
                  label="Session date (YYYY-MM-DD)"
                  value={manualDate}
                  onChangeText={setManualDate}
                  autoCapitalize="none"
                  placeholder={toISODate(new Date())}
                />
                {matchSessions.length > 0 ? (
                  <Body secondary>Found a matching session on that date.</Body>
                ) : (
                  <Body secondary>No matching session found yet — check the course and date.</Body>
                )}
                {applied ? (
                  <Badge label="Applied to your schedule" tone="success" />
                ) : (
                  <Button label="Confirm and update schedule" onPress={apply} disabled={!manualCourseId || !manualDate} />
                )}
              </>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <Subtitle>Or just mark it manually</Subtitle>
          <Body secondary>
            No email? Open the course from the Schedule tab and edit a specific session&apos;s
            status directly from there in a future update — for now, use the email flow above
            with a short manual note (e.g. &quot;Class canceled today&quot;).
          </Body>
        </Card>
      </ScrollView>
    </Screen>
  );
}
