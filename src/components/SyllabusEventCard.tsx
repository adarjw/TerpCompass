/**
 * One quiz/exam/homework item auto-detected from a syllabus (see
 * `src/lib/syllabusDates.ts`), used by both the Dashboard's aggregate
 * "Detected from your syllabi" card and a single course's own detail page.
 *
 * Tapping the row toggles "done" (a lightweight personal checklist, tracked
 * in `syllabus_event_completions` since detected items aren't persisted
 * rows of their own). The checkbox area and the "Add to calendar" button
 * are siblings, not nested — the app already has one pre-existing
 * <button>-inside-<button> DOM warning elsewhere on web, and stacking a
 * Button inside a Pressable here would add a second one.
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import { SYLLABUS_EVENT_LABEL, type DetectedSyllabusEvent } from '@/lib/syllabusDates';
import { formatDateHuman } from '@/lib/time';
import { Badge, Body, Button, Card, FONT, Icon, Row, useColors } from './ui';

export function SyllabusEventCard({
  event,
  courseCode,
  done,
  onToggleDone,
  onAddToCalendar,
}: {
  event: DetectedSyllabusEvent;
  /** Omit on a single course's own page, where it'd be redundant. */
  courseCode?: string;
  done: boolean;
  onToggleDone: () => void;
  onAddToCalendar: () => void;
}) {
  const c = useColors();
  return (
    <Card style={{ paddingVertical: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Pressable
          onPress={onToggleDone}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? 'Mark not done' : 'Mark done'}
          style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
          <Icon
            name={done ? 'checkbox' : 'square-outline'}
            size={19}
            color={done ? c.success : c.textSecondary}
            style={{ marginTop: 2 }}
          />
          <View style={{ flex: 1, opacity: done ? 0.6 : 1 }}>
            <Row style={{ gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              {courseCode ? <Body style={{ fontFamily: FONT.bold }}>{courseCode}</Body> : null}
              <Badge
                label={SYLLABUS_EVENT_LABEL[event.kind]}
                tone={event.kind === 'exam' ? 'danger' : event.kind === 'quiz' ? 'warning' : 'neutral'}
              />
            </Row>
            {event.topic ? (
              <Body style={{ textDecorationLine: done ? 'line-through' : 'none' }}>{event.topic}</Body>
            ) : null}
            <Body secondary style={{ fontSize: 13 }}>
              {formatDateHuman(event.dateISO)} · {event.sourceFilename}
              {event.page ? `, p.${event.page}` : ''}
            </Body>
          </View>
        </Pressable>
        <Button label="Add to calendar" kind="secondary" compact onPress={onAddToCalendar} />
      </Row>
    </Card>
  );
}
