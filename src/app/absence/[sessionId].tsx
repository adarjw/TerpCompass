/**
 * Record an absence for one exact session: optional reason, running count
 * for the course, attendance-policy impact if known, and an immediate offer
 * to build a catch-up plan. No shaming — missing class happens.
 */

import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

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
import {
  absencesRepo,
  chunksRepo,
  coursesRepo,
  plansRepo,
  sessionsRepo,
  resourcesRepo,
  tasksRepo,
} from '@/db/repo';
import { makeId } from '@/lib/ids';
import { providerFor, localProvider } from '@/lib/ai';
import {
  ABSENCE_REASON_LABEL,
  buildAbsenceEmailDraft,
  mailtoUrl,
  type AbsenceReasonCategory,
} from '@/lib/emailDrafts';
import { formatDateHuman } from '@/lib/time';
import type { Absence, CatchUpPlan, ClassSession, Course } from '@/lib/types';
import { useApp } from '@/state/AppContext';

const EMAIL_REASON_CATEGORIES: AbsenceReasonCategory[] = [
  'illness',
  'off_campus',
  'medical_appointment',
  'mental_health',
  'conflict',
];

export default function AbsenceScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { db, settings, bump, rescheduleNotifications } = useApp();
  const [session, setSession] = useState<ClassSession | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [missedCount, setMissedCount] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Absence | null>(null);
  const [emailCategory, setEmailCategory] = useState<AbsenceReasonCategory | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  useEffect(() => {
    (async () => {
      if (!db || !sessionId) return;
      const s = await sessionsRepo.byId(db, sessionId);
      setSession(s);
      if (s) {
        setCourse(await coursesRepo.byId(db, s.courseId));
        setMissedCount((await absencesRepo.forCourse(db, s.courseId)).length);
      }
    })();
  }, [db, sessionId]);

  if (!session || !course) return <Loading />;

  const recordAbsence = async (): Promise<Absence | null> => {
    if (!db) return null;
    const absence: Absence = {
      id: makeId(),
      sessionId: session.id,
      courseId: course.id,
      date: session.date,
      reason: reason.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    await absencesRepo.insert(db, absence);
    await sessionsRepo.setStatus(db, session.id, 'absent');
    bump();
    await rescheduleNotifications();
    return absence;
  };

  const buildPlan = async (absence: Absence): Promise<CatchUpPlan | null> => {
    if (!db) return null;
    const chunks = await chunksRepo.forCourse(db, course.id);
    const resources = await resourcesRepo.forCourse(db, course.id);
    const resourceKinds = Object.fromEntries(resources.map((r) => [r.id, r.kind]));

    const provider = providerFor(settings);
    let result = await provider.generateCatchUpPlan({
      absenceId: absence.id,
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      sessionDate: session.date,
      chunks,
      resourceKinds,
    });
    if (!result.ok && provider.id !== 'local') {
      // Visible fallback — never silently swap providers.
      setAiNotice(`${provider.label} failed (${result.error.message}) — using the built-in plan instead.`);
      result = await localProvider.generateCatchUpPlan({
        absenceId: absence.id,
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        sessionDate: session.date,
        chunks,
        resourceKinds,
      });
    }
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    const plan = result.value;
    await plansRepo.save(db, plan);
    await absencesRepo.linkPlan(db, absence.id, plan.id);

    // Absence recovery tasks: one per minimum-viable item, due before the
    // course's next session (roughly +3 days as a helpful default).
    const due = plan.sessionDate;
    for (const item of plan.minimumViable) {
      await tasksRepo.insert(db, {
        id: makeId(),
        planId: plan.id,
        courseId: course.id,
        title: item,
        dueDate: due,
        done: false,
        createdAt: new Date().toISOString(),
      });
    }
    bump();
    return plan;
  };

  const onSkipOnly = async () => {
    setSaving(true);
    setError(null);
    try {
      const a = await recordAbsence();
      if (a) setSaved(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onSkipAndPlan = async () => {
    setSaving(true);
    setError(null);
    try {
      const a = await recordAbsence();
      if (!a) return;
      const plan = await buildPlan(a);
      if (plan) router.replace(`/plan/${plan.id}`);
      else setSaved(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const pickEmailReason = (category: AbsenceReasonCategory) => {
    const draft = buildAbsenceEmailDraft({
      category,
      course,
      session,
      studentName: settings.studentName,
    });
    setEmailCategory(category);
    setEmailTo(draft.to);
    setEmailCc(draft.cc);
    setEmailSubject(draft.subject);
    setEmailBody(draft.body);
  };

  const openInMailApp = () => {
    Linking.openURL(mailtoUrl({ to: emailTo, cc: emailCc, subject: emailSubject, body: emailBody }));
  };

  const newTotal = missedCount + 1;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Title>Missing {course.code}?</Title>
        <Body secondary style={{ marginBottom: 12 }}>
          {formatDateHuman(session.date)} · {course.name}. Life happens — let&apos;s make sure you
          can catch up easily.
        </Body>
        {error ? <ErrorBox message={error} /> : null}
        {aiNotice ? <ErrorBox message={aiNotice} /> : null}

        {saved ? (
          <>
            <Card>
              <Badge label="Absence recorded" tone="success" />
              <Body style={{ marginTop: 8 }}>
                You&apos;ve missed {newTotal} class{newTotal === 1 ? '' : 'es'} in {course.code} this
                semester.
              </Body>
            </Card>

            <Card>
              <Subtitle>Email your professor (optional)</Subtitle>
              <Body secondary style={{ fontSize: 13, marginBottom: 8 }}>
                This only drafts an email — nothing is sent until you review and press send in your
                own mail app.
              </Body>
              <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                {EMAIL_REASON_CATEGORIES.map((category) => (
                  <View key={category} style={{ minWidth: 130, flex: 1 }}>
                    <Button
                      label={ABSENCE_REASON_LABEL[category]}
                      kind={emailCategory === category ? 'primary' : 'secondary'}
                      compact
                      onPress={() => pickEmailReason(category)}
                    />
                  </View>
                ))}
              </Row>
              {emailCategory ? (
                <>
                  <Field label="To" value={emailTo} onChangeText={setEmailTo} placeholder="professor@umd.edu" autoCapitalize="none" />
                  <Field label="Cc" value={emailCc} onChangeText={setEmailCc} placeholder="ta@umd.edu" autoCapitalize="none" />
                  <Field label="Subject" value={emailSubject} onChangeText={setEmailSubject} />
                  <Field label="Body" value={emailBody} onChangeText={setEmailBody} multiline />
                  {!emailTo ? (
                    <Body secondary style={{ fontSize: 12, marginBottom: 8 }}>
                      No professor email on file for this course — add one on the course page, or
                      just type it in above.
                    </Body>
                  ) : null}
                  <Button label="Open in Mail app" onPress={openInMailApp} />
                </>
              ) : null}
            </Card>

            <Button label="Done" kind="secondary" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <Card>
              <Field
                label="Reason (optional, just for you)"
                value={reason}
                onChangeText={setReason}
                placeholder="Sick / interview / overslept…"
              />
              <Subtitle>This course so far</Subtitle>
              <Body>
                Recorded absences: {missedCount} → this would be #{newTotal}
              </Body>
              {course.attendancePolicy ? (
                <Body secondary style={{ marginTop: 6 }}>
                  Attendance policy: {course.attendancePolicy}
                </Body>
              ) : (
                <Body secondary style={{ marginTop: 6 }}>
                  No attendance policy on file — add one on the course page to see grade impact
                  here.
                </Body>
              )}
            </Card>
            <Button
              label={saving ? 'Working…' : 'Record absence + build catch-up plan'}
              onPress={onSkipAndPlan}
              disabled={saving}
            />
            <Button
              label="Just record the absence"
              kind="secondary"
              onPress={onSkipOnly}
              disabled={saving}
            />
            <Button label="Cancel" kind="ghost" onPress={() => router.back()} disabled={saving} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
