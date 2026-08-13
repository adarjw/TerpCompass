/**
 * Demo data: a realistic UMD-style fall schedule plus a sample syllabus so
 * every feature (importance, catch-up plans, citations) is demonstrable
 * before the user imports anything real. Clearly labeled in the UI and
 * removable in one tap.
 */

import { makeId } from './ids';
import { addDaysISO, toISODate } from './time';
import type { Course, MeetingPattern, Resource, ResourceChunk } from './types';
import { chunkResourceText } from './syllabus';

export interface SampleCourseSet {
  course: Course;
  patterns: MeetingPattern[];
}

/** Semester window anchored to "today" so demo classes actually show up. */
export function sampleSemester(now: Date): { start: string; end: string } {
  const start = addDaysISO(toISODate(now), -28);
  const end = addDaysISO(toISODate(now), 63);
  return { start, end };
}

export function buildSampleCourses(now: Date): SampleCourseSet[] {
  const { start, end } = sampleSemester(now);
  const created = now.toISOString();

  const cmscId = makeId();
  const mathId = makeId();
  const englId = makeId();

  return [
    {
      course: {
        id: cmscId,
        code: 'CMSC216',
        name: 'Introduction to Computer Systems',
        professor: 'Prof. Rivera',
        professorEmail: 'rivera@umd.edu',
        taEmails: 'ta-cmsc216@umd.edu',
        semesterStart: start,
        semesterEnd: end,
        attendancePolicy:
          'Attendance is taken via in-class exercises worth 10% of your grade. No make-ups.',
        walkingBufferMin: 5,
        color: '#E21833',
        createdAt: created,
      },
      patterns: [
        {
          id: makeId(),
          courseId: cmscId,
          label: 'lecture',
          building: 'IRB',
          room: '0324',
          meetingDays: [1, 3, 5],
          startTime: '10:00',
          endTime: '10:50',
        },
      ],
    },
    {
      // Demonstrates a course with a separate lecture + discussion, like a
      // real UMD schedule (e.g. MATH246: Lec TTh + Dis F in a different room).
      course: {
        id: mathId,
        code: 'MATH241',
        name: 'Calculus III',
        professor: 'Prof. Osei',
        semesterStart: start,
        semesterEnd: end,
        attendancePolicy: 'Attendance not graded, but quizzes happen in discussion.',
        color: '#FFD200',
        createdAt: created,
      },
      patterns: [
        {
          id: makeId(),
          courseId: mathId,
          label: 'lecture',
          building: 'MTH',
          room: '0102',
          meetingDays: [2, 4],
          startTime: '12:30',
          endTime: '13:45',
        },
        {
          id: makeId(),
          courseId: mathId,
          label: 'discussion',
          building: 'MTH',
          room: '0201',
          meetingDays: [5],
          startTime: '11:00',
          endTime: '11:50',
        },
      ],
    },
    {
      course: {
        id: englId,
        code: 'ENGL101',
        name: 'Academic Writing',
        professor: 'Prof. Chen',
        semesterStart: start,
        semesterEnd: end,
        color: '#4B9CD3',
        createdAt: created,
      },
      patterns: [
        {
          id: makeId(),
          courseId: englId,
          label: 'lecture',
          building: 'TYD',
          room: '1101',
          meetingDays: [1, 3],
          startTime: '14:00',
          endTime: '15:15',
        },
      ],
    },
  ];
}

/** A small syllabus whose dates track the demo semester. */
export function buildSampleSyllabus(
  course: Course,
  now: Date,
): { resource: Resource; chunks: ResourceChunk[] } {
  const base = toISODate(now);
  const fmt = (offsetDays: number) => addDaysISO(base, offsetDays);
  const filename = `${course.code}-syllabus-sample.txt`;
  const text = [
    `${course.code} — ${course.name}`,
    `Instructor: ${course.professor}`,
    '',
    'Course schedule:',
    `${fmt(-7)}: Pointers and memory layout. Read Chapter 5, pp. 88-104.`,
    `${fmt(-5)}: Dynamic allocation, malloc/free. Problem Set 3 assigned.`,
    `${fmt(-2)}: Debugging with GDB and Valgrind. Read Chapter 6.`,
    `${fmt(0)}: Process model and system calls. Read Chapter 7, pp. 120-141.`,
    `${fmt(2)}: I/O and file descriptors. Problem Set 3 due.`,
    `${fmt(5)}: Quiz 2 on memory and processes.`,
    `${fmt(7)}: Signals. Read Chapter 8.`,
    `${fmt(9)}: Midterm review session. Attendance strongly recommended.`,
    `${fmt(12)}: Midterm exam in class.`,
    '',
    'Attendance policy: In-class exercises count 10% of the final grade. No make-ups.',
  ].join('\n');

  const resource: Resource = {
    id: makeId(),
    courseId: course.id,
    kind: 'syllabus',
    title: `${course.code} Syllabus (sample)`,
    originalFilename: filename,
    addedAt: now.toISOString(),
    extractionStatus: 'ok',
  };
  const chunks = chunkResourceText(
    {
      resourceId: resource.id,
      courseId: course.id,
      sourceFilename: filename,
      pages: [{ page: 1, text }],
      defaultYear: now.getFullYear(),
    },
    makeId,
  );
  return { resource, chunks };
}
