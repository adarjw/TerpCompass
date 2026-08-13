/**
 * Database bootstrap. The repositories in repo.ts depend only on the small
 * SqlExecutor interface so they can be exercised against a fake in tests;
 * the app injects the real expo-sqlite database from here.
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { ALL_TABLES, CREATE_TABLES, SCHEMA_VERSION } from './schema';

export interface SqlRow {
  [column: string]: unknown;
}

export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<void>;
  getAllAsync<T = SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = SqlRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

function wrap(db: SQLiteDatabase): SqlExecutor {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params = []) => {
      await db.runAsync(sql, params as never[]);
    },
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params as never[]),
    getFirstAsync: (sql, params = []) => db.getFirstAsync(sql, params as never[]),
  };
}

let instance: Promise<SqlExecutor> | null = null;
let rawDb: SQLiteDatabase | null = null;

export function getDb(): Promise<SqlExecutor> {
  if (!instance) {
    instance = (async () => {
      const db = await openDatabaseAsync('terrapin.db');
      rawDb = db;
      // WAL mode defers writes to a separate log file that's only merged
      // into the main database on a checkpoint. On native that's safe (real
      // file I/O with proper fsync). On web, wa-sqlite's IndexedDB-backed
      // VFS doesn't checkpoint on page unload, so isolated writes not
      // followed by enough activity to trigger an auto-checkpoint can be
      // silently lost on reload. This is a local-first, single-writer app
      // with no need for WAL's concurrent-reader benefit, so we just use
      // the safer default (rollback journal) on web.
      const journalMode = Platform.OS === 'web' ? 'DELETE' : 'WAL';
      await db.execAsync(`PRAGMA journal_mode = ${journalMode}; PRAGMA foreign_keys = ON;`);
      await migrate(wrap(db));
      return wrap(db);
    })();
  }
  return instance;
}

export async function migrate(db: SqlExecutor): Promise<void> {
  let current = 0;
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'schema_version'`,
    );
    if (row) current = Number(row.value);
  } catch {
    current = 0; // app_settings doesn't exist yet: genuinely fresh install.
  }
  const startedAt = current;

  if (current > 0 && current < 2) {
    // v1 -> v2 restructured courses/sessions incompatibly (meeting patterns
    // split out). No real user base at the time, so tables were dropped and
    // recreated rather than column-migrated. Treat as fresh afterward so the
    // v2->v3 step below doesn't try to ALTER tables that no longer exist.
    for (const table of ALL_TABLES) {
      await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
    }
    current = 0;
  }

  // Idempotent: creates whatever tables are still missing (including a
  // from-scratch install, which already gets the full current schema here).
  await db.execAsync(CREATE_TABLES);

  if (current > 0 && current < 3) {
    // v2 -> v3: additive columns for professor/TA contact emails.
    for (const sql of [
      `ALTER TABLE courses ADD COLUMN professor_email TEXT;`,
      `ALTER TABLE courses ADD COLUMN ta_emails TEXT;`,
    ]) {
      try {
        await db.execAsync(sql);
      } catch {
        // Column already exists (e.g. re-running migrate); safe to ignore.
      }
    }
  }

  if (startedAt < SCHEMA_VERSION) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('schema_version', ?)`,
      [String(SCHEMA_VERSION)],
    );
  }
}

/** "Delete all local data": drops every row, keeps the schema. */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM notifications;
    DELETE FROM catch_up_tasks;
    DELETE FROM catch_up_plans;
    DELETE FROM extracted_resource_chunks;
    DELETE FROM resources;
    DELETE FROM absences;
    DELETE FROM class_notes;
    DELETE FROM class_sessions;
    DELETE FROM meeting_patterns;
    DELETE FROM calendar_events;
    DELETE FROM courses;
    DELETE FROM campus_locations;
    DELETE FROM walk_recordings;
    DELETE FROM app_settings;
  `);
  await migrate(db);
}

/** For debugging/tests on web where the module may need a reset. */
export function _resetDbForTests() {
  instance = null;
  rawDb = null;
}

export function getRawDb(): SQLiteDatabase | null {
  return rawDb;
}
