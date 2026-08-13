/**
 * Catch-up plan: topic + confidence, cited readings/files/problems,
 * minimum-viable vs deeper checklist, quiz, editable notes.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ErrorBox,
  Field,
  FONT,
  IconRow,
  Loading,
  Row,
  Screen,
  Subtitle,
  Title,
  useColors,
} from '@/components/ui';
import { coursesRepo, plansRepo, tasksRepo } from '@/db/repo';
import { formatDateHuman } from '@/lib/time';
import type { CatchUpPlan, CatchUpTask, Citation, Course } from '@/lib/types';
import { useApp } from '@/state/AppContext';

function citeText(c?: Citation): string {
  if (!c) return '';
  return ` — ${c.sourceFilename}${c.page ? `, p.${c.page}` : ''}`;
}

const CONFIDENCE_TONE = {
  high: 'success',
  medium: 'accent',
  low: 'warning',
  none: 'danger',
} as const;

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, version, bump } = useApp();
  const c = useColors();
  const [plan, setPlan] = useState<CatchUpPlan | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [tasks, setTasks] = useState<CatchUpTask[]>([]);
  const [notes, setNotes] = useState('');
  const [topicEdit, setTopicEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState<Record<number, boolean>>({});

  useFocusEffect(
    useCallback(() => {
      (async () => {
        if (!db || !id) return;
        const p = await plansRepo.byId(db, id);
        setPlan(p);
        setNotes(p?.userNotes ?? '');
        if (p) {
          setCourse(await coursesRepo.byId(db, p.courseId));
          setTasks(await tasksRepo.forPlan(db, p.id));
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version bumps trigger a reload
    }, [db, id, version]),
  );

  if (!plan) return <Loading />;

  const savePlan = async (updated: CatchUpPlan) => {
    if (!db) return;
    try {
      await plansRepo.save(db, updated);
      setPlan(updated);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleItem = (list: 'requiredReadings' | 'problems', index: number) => {
    const items = plan[list].map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    savePlan({ ...plan, [list]: items });
  };

  const toggleTask = async (task: CatchUpTask) => {
    if (!db) return;
    await tasksRepo.setDone(db, task.id, !task.done);
    setTasks(await tasksRepo.forPlan(db, plan.id));
    bump();
  };

  const check = (done: boolean) => (
    <Ionicons
      name={done ? 'checkbox' : 'square-outline'}
      size={19}
      style={{ marginRight: 8, marginTop: 1 }}
      color={done ? c.success : c.textSecondary}
    />
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
        <Title>
          {course?.code ?? ''} · missed {formatDateHuman(plan.sessionDate)}
        </Title>
        <Row style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Badge label={`Confidence: ${plan.confidence}`} tone={CONFIDENCE_TONE[plan.confidence]} />
          {plan.aiGenerated ? <Badge label="AI-generated — review before trusting" tone="warning" /> : <Badge label="Built on-device from your files" tone="success" />}
        </Row>
        {error ? <ErrorBox message={error} /> : null}

        {plan.notice ? (
          <Card style={{ borderColor: c.warning, borderWidth: 1 }}>
            <Body>{plan.notice}</Body>
            <Field
              label="Set the topic yourself"
              value={topicEdit ?? ''}
              onChangeText={setTopicEdit}
              placeholder="e.g. Process model and system calls"
            />
            <Button
              label="Save topic"
              compact
              disabled={!topicEdit?.trim()}
              onPress={() =>
                savePlan({
                  ...plan,
                  likelyTopic: topicEdit!.trim(),
                  confidence: 'medium',
                  notice: undefined,
                  generatedBy: 'manual',
                })
              }
            />
          </Card>
        ) : (
          <Card>
            <Subtitle>Likely missed topic</Subtitle>
            <Body style={{ fontSize: 18, fontFamily: FONT.bold }}>{plan.likelyTopic ?? 'Unknown'}</Body>
            {plan.estimatedMinutes ? <Body secondary>Estimated time: ~{plan.estimatedMinutes} min</Body> : null}
            {plan.prerequisites.length > 0 ? (
              <Body secondary>Builds on: {plan.prerequisites.join('; ')}</Body>
            ) : null}
          </Card>
        )}

        {plan.minimumViable.length > 0 ? (
          <Card>
            <Subtitle>Minimum viable catch-up</Subtitle>
            {tasks.length > 0
              ? tasks.map((t) => (
                  <Pressable key={t.id} onPress={() => toggleTask(t)} accessibilityRole="checkbox">
                    <Row style={{ marginBottom: 6 }}>
                      {check(t.done)}
                      <Body style={{ flex: 1, textDecorationLine: t.done ? 'line-through' : 'none' }}>{t.title}</Body>
                    </Row>
                  </Pressable>
                ))
              : plan.minimumViable.map((item, i) => (
                  <Body key={i}>• {item}</Body>
                ))}
          </Card>
        ) : null}

        {plan.requiredReadings.length > 0 ? (
          <Card>
            <Subtitle>Readings & materials</Subtitle>
            {plan.requiredReadings.map((item, i) => (
              <Pressable key={i} onPress={() => toggleItem('requiredReadings', i)} accessibilityRole="checkbox">
                <Row style={{ marginBottom: 8, alignItems: 'flex-start' }}>
                  {check(item.done)}
                  <Body style={{ flex: 1, textDecorationLine: item.done ? 'line-through' : 'none' }}>
                    {item.text}
                    <Text style={{ color: c.textSecondary, fontSize: 12 }}>{citeText(item.citation)}</Text>
                  </Body>
                </Row>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {plan.problems.length > 0 ? (
          <Card>
            <Subtitle>Problems to complete</Subtitle>
            {plan.problems.map((item, i) => (
              <Pressable key={i} onPress={() => toggleItem('problems', i)} accessibilityRole="checkbox">
                <Row style={{ marginBottom: 8, alignItems: 'flex-start' }}>
                  {check(item.done)}
                  <Body style={{ flex: 1 }}>
                    {item.text}
                    <Text style={{ color: c.textSecondary, fontSize: 12 }}>{citeText(item.citation)}</Text>
                  </Body>
                </Row>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {plan.relevantFiles.length > 0 ? (
          <Card>
            <Subtitle>Relevant files</Subtitle>
            {plan.relevantFiles.map((f, i) => (
              <IconRow key={i} icon="document-text-outline">
                {f.sourceFilename}
                {f.page ? ` — page ${f.page}` : ''}
              </IconRow>
            ))}
          </Card>
        ) : null}

        {plan.deeperVersion.length > 0 ? (
          <Card>
            <Subtitle>If you have more time</Subtitle>
            {plan.deeperVersion.map((item, i) => (
              <Body key={i}>• {item}</Body>
            ))}
          </Card>
        ) : null}

        {plan.quiz.length > 0 ? (
          <Card>
            <Subtitle>Check yourself</Subtitle>
            {plan.quiz.map((q, i) => (
              <View key={i} style={{ marginBottom: 12 }}>
                <Body style={{ fontFamily: FONT.bold }}>
                  {i + 1}. {q.question}
                </Body>
                {q.options.map((opt, oi) => (
                  <Body key={oi} secondary>
                    {String.fromCharCode(65 + oi)}. {opt}
                  </Body>
                ))}
                {q.options.length > 0 ? (
                  <Pressable onPress={() => setShowAnswers((s) => ({ ...s, [i]: !s[i] }))}>
                    <Body style={{ color: c.accent, fontSize: 13 }}>
                      {showAnswers[i] ? `Answer: ${String.fromCharCode(65 + q.answerIndex)}` : 'Show answer'}
                    </Body>
                  </Pressable>
                ) : null}
                {q.citation ? (
                  <Body secondary style={{ fontSize: 12 }}>
                    Source: {q.citation.sourceFilename}
                    {q.citation.page ? `, p.${q.citation.page}` : ''}
                  </Body>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Field label="Your notes (editable)" value={notes} onChangeText={setNotes} multiline placeholder="Anything to add or correct…" />
          <Button label="Save notes" kind="secondary" compact onPress={() => savePlan({ ...plan, userNotes: notes })} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
