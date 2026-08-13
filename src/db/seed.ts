/** Seeding: UMD building list on first run, and optional demo data. */

import { UMD_BUILDINGS } from '../lib/campus';
import { makeId } from '../lib/ids';
import { buildSampleCourses, buildSampleSyllabus } from '../lib/sample';
import { generateSessions } from '../lib/sessions';
import type { SqlExecutor } from './database';
import {
  chunksRepo,
  coursesRepo,
  locationsRepo,
  patternsRepo,
  resourcesRepo,
  sessionsRepo,
} from './repo';

export async function seedBuildingsIfEmpty(db: SqlExecutor): Promise<void> {
  const existing = await locationsRepo.all(db);
  if (existing.length > 0) return;
  for (const b of UMD_BUILDINGS) {
    await locationsRepo.upsert(db, { id: makeId(), ...b });
  }
}

/** Load demo courses + sample syllabus. Returns number of courses added. */
export async function loadDemoData(db: SqlExecutor, now: Date): Promise<number> {
  const sets = buildSampleCourses(now);
  for (const { course, patterns } of sets) {
    await coursesRepo.upsert(db, course);
    await patternsRepo.insertMany(db, patterns);
    await sessionsRepo.insertMany(db, generateSessions(course, patterns, makeId));
  }
  // Attach the sample syllabus to the first course (CMSC216).
  const { resource, chunks } = buildSampleSyllabus(sets[0].course, now);
  await resourcesRepo.insert(db, resource);
  await chunksRepo.insertMany(db, chunks);
  return sets.length;
}
