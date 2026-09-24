// ============================================================================
// AI bridge — the Hoard family (main process)
// ============================================================================
//
// What makes this port a member of the family of local Hoard apps: a
// `hoard_link` block in /api/health so the hub's audit sees the app is on the
// contract, and one `agent.call` event per tool call posted to the hub's bus
// (fire-and-forget: the hub being absent never slows or fails a call).
//
//   HOARD_HUB_URL   where the hub listens (default http://127.0.0.1:8810)
//   HOARD_EVENTS=0  never post anything
//
// The bearer token is the bridge's own (`<userData>/aibridge/token`): the hub
// records the event's source from it, so this app can only speak for itself.

import http from 'node:http';
import { getBridgeToken } from './state';

export const FAMILY_APP_ID = 'writer';
export const FAMILY_VERSION = '0.4.0';
const MAX_DATA_BYTES = 16 * 1024;

function hubUrl(): string {
  return (process.env.HOARD_HUB_URL || 'http://127.0.0.1:8810').replace(/\/+$/, '');
}

function eventsEnabled(): boolean {
  const raw = (process.env.HOARD_EVENTS ?? '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

const stats = { sent: 0, dropped: 0, lastError: '' };

/** Post one event to the hub's bus. Never throws, never waits. */
export function emitFamilyEvent(type: string, data: Record<string, unknown> = {}): void {
  if (!eventsEnabled()) return;
  void (async () => {
    let token = '';
    try {
      token = await getBridgeToken();
    } catch {
      return;
    }
    let payload = JSON.stringify({ type, source: FAMILY_APP_ID, data });
    if (Buffer.byteLength(payload) > MAX_DATA_BYTES) {
      payload = JSON.stringify({ type, source: FAMILY_APP_ID, data: { truncated: true } });
    }
    const target = new URL('/api/events', hubUrl());
    const req = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        method: 'POST',
        timeout: 3000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        if (res.statusCode === 200) stats.sent += 1;
        else {
          stats.dropped += 1;
          stats.lastError = `HTTP ${res.statusCode}`;
        }
        res.resume();
      },
    );
    req.on('error', (err) => {
      stats.dropped += 1;
      stats.lastError = err.message;
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  })();
}

/** The block every family app adds to its /api/health answer. */
export function familyHealthBlock(): Record<string, unknown> {
  return {
    version: FAMILY_VERSION,
    family: FAMILY_VERSION,
    events: eventsEnabled(),
    app: FAMILY_APP_ID,
    hub: hubUrl(),
    sent: stats.sent,
    dropped: stats.dropped,
  };
}
