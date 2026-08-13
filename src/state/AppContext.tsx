/**
 * App-wide context: opens the database, loads settings, seeds the campus
 * building list, and exposes a change counter that screens use to reload
 * after any mutation. Also centralizes notification rescheduling so every
 * schedule/settings change re-plans reminders.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { getDb, type SqlExecutor } from '../db/database';
import {
  coursesRepo,
  locationsRepo,
  sessionsRepo,
  settingsRepo,
  tasksRepo,
} from '../db/repo';
import { seedBuildingsIfEmpty } from '../db/seed';
import { rescheduleAll } from '../services/notifications';
import type { AppSettings } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';

interface AppContextValue {
  db: SqlExecutor | null;
  ready: boolean;
  initError: string | null;
  settings: AppSettings;
  saveSettings: (s: AppSettings) => Promise<void>;
  /** Increments after any data mutation; screens reload when it changes. */
  version: number;
  bump: () => void;
  /** Re-plan all local notifications from current data + settings. */
  rescheduleNotifications: () => Promise<void>;
  /** Resolved color scheme after applying the settings override. */
  scheme: 'light' | 'dark';
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SqlExecutor | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [version, setVersion] = useState(0);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const database = await getDb();
        await seedBuildingsIfEmpty(database);
        const loaded = await settingsRepo.get(database);
        if (!cancelled) {
          setSettings(loaded);
          setDb(database);
        }
      } catch (e) {
        if (!cancelled) {
          setInitError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const rescheduleNotifications = useCallback(async () => {
    if (!db) return;
    try {
      const [sessions, courses, buildings, tasks] = await Promise.all([
        sessionsRepo.all(db),
        coursesRepo.all(db),
        locationsRepo.all(db),
        tasksRepo.all(db),
      ]);
      await rescheduleAll(db, { sessions, courses, buildings, tasks });
    } catch {
      // Notification failures must never break data flows.
    }
  }, [db]);

  const saveSettings = useCallback(
    async (s: AppSettings) => {
      if (!db) return;
      await settingsRepo.save(db, s);
      setSettings(s);
      bump();
    },
    [db, bump],
  );

  const scheme: 'light' | 'dark' =
    settings.darkMode === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : settings.darkMode;

  const value = useMemo(
    () => ({
      db,
      ready: db !== null,
      initError,
      settings,
      saveSettings,
      version,
      bump,
      rescheduleNotifications,
      scheme,
    }),
    [db, initError, settings, saveSettings, version, bump, rescheduleNotifications, scheme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
