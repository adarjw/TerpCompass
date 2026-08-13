/**
 * Provider registry. Selection order is explicit: the app uses exactly the
 * provider chosen in Settings, and if it fails or is unavailable the caller
 * falls back to the local provider (with a visible notice — never silently).
 */

import type { AppSettings } from '../types';
import { CliProvider, unavailableTransport, type CliTransport } from './cliProvider';
import { LocalProvider } from './localProvider';
import type { AIProvider } from './types';

export const localProvider = new LocalProvider();

/**
 * On native there is no process runner; a desktop/companion build can inject
 * a real transport here without touching any other code.
 */
let cliTransport: CliTransport = unavailableTransport;
export function setCliTransport(t: CliTransport) {
  cliTransport = t;
}

export function providerFor(settings: AppSettings): AIProvider {
  if (!settings.aiCliEnabled) return localProvider;
  switch (settings.aiProviderId) {
    case 'claude-cli':
      return new CliProvider(
        'claude-cli',
        'Claude CLI (opt-in)',
        {
          enabled: settings.aiCliEnabled,
          commandPath: settings.aiCliPath || 'claude',
          promptArgs: ['-p'],
        },
        cliTransport,
      );
    case 'other-cli':
      return new CliProvider(
        'other-cli',
        'Custom CLI (opt-in)',
        {
          enabled: settings.aiCliEnabled,
          commandPath: settings.aiCliPath,
          promptArgs: [],
        },
        cliTransport,
      );
    default:
      return localProvider;
  }
}

export type { AIProvider } from './types';
