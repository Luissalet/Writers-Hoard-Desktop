#!/usr/bin/env node
// ============================================================================
// wh-bridge — command line for the local AI bridge
// ============================================================================
//
// Exists so a change can be verified without a human clicking through the app,
// and without fighting a shell's quoting rules:
//
//   node scripts/wh-bridge.mjs health
//   node scripts/wh-bridge.mjs tools [group,group]
//   node scripts/wh-bridge.mjs selftest [--keep]
//   node scripts/wh-bridge.mjs call wh_search '{"query":"quokka"}'
//   node scripts/wh-bridge.mjs call wh_list_projects
//   node scripts/wh-bridge.mjs audit [n]
//
// The token is read from userData, so nothing has to be pasted. Exit code is 1
// when the call failed, so this composes with && in a script.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.WH_BRIDGE_URL || 'http://127.0.0.1:8766';

function tokenFile() {
  const names = ['writers-hoard', 'Writers Hoard'];
  const roots = names.map((name) => {
    if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', name);
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
  });
  for (const root of roots) {
    const file = path.join(root, 'aibridge', 'token');
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const TOKEN = (process.env.WH_BRIDGE_TOKEN || '').trim()
  || (tokenFile() ? fs.readFileSync(tokenFile(), 'utf8').trim() : '');

function request(method, route, payload) {
  return new Promise((resolve) => {
    const url = new URL(route, BASE);
    const data = payload === undefined ? undefined : JSON.stringify(payload);
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {}),
        },
        timeout: 660_000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: { ok: false, error: raw.slice(0, 800) } });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (err) => resolve({ status: 0, body: { ok: false, code: 'unreachable', error: err.message } }));
    if (data) req.write(data);
    req.end();
  });
}

function out(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Tool arguments, in whichever form survives the shell you are in.
 *
 *   key=value pairs   type=writing id=abc123 limit=5 orphanedOnly=true
 *   a JSON blob       '{"type":"writing"}'
 *   a file            @args.json
 *
 * The pair form exists because PowerShell eats double quotes out of argv, so a
 * JSON literal on the command line is not reliably deliverable there.
 */
function parseArgs(tokens) {
  if (!tokens.length) return {};

  if (tokens.length === 1 && tokens[0].startsWith('@')) {
    return JSON.parse(fs.readFileSync(tokens[0].slice(1), 'utf8'));
  }
  if (tokens.length === 1 && /^\s*[{[]/.test(tokens[0])) {
    try {
      return JSON.parse(tokens[0]);
    } catch (err) {
      throw new Error(
        `arguments are not valid JSON (${err.message}). In PowerShell prefer key=value pairs, `
        + 'which no shell mangles: wh-bridge call wh_delete type=writing id=abc123',
      );
    }
  }

  const args = {};
  for (const token of tokens) {
    const split = token.indexOf('=');
    if (split < 1) throw new Error(`"${token}" is not key=value, JSON, or @file`);
    const key = token.slice(0, split);
    const raw = token.slice(split + 1);
    if (raw === 'true' || raw === 'false') args[key] = raw === 'true';
    else if (raw !== '' && !Number.isNaN(Number(raw))) args[key] = Number(raw);
    else if (/^\s*[{[]/.test(raw)) args[key] = JSON.parse(raw);
    else args[key] = raw;
  }
  return args;
}

/** A self-test report is long; print the verdict and only what failed. */
function printSelfTest(report) {
  const checks = report.checks ?? [];
  for (const check of checks) {
    const mark = check.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`${mark}  ${check.name}${check.ok ? '' : `\n      ${check.detail}`}\n`);
  }
  process.stdout.write(
    `\n${report.ok ? 'OK' : 'FAILED'}: ${report.passed} passed, ${report.failed} failed `
    + `in ${report.totalMs}ms. Scratch project ${report.cleanedUp ? 'deleted' : `KEPT (${report.projectId})`}.\n`,
  );
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!TOKEN) {
    out({ ok: false, error: 'No bridge token found. Is Writers Hoard installed and the bridge on?' });
    process.exit(1);
  }

  switch (command) {
    case 'health': {
      const { body } = await request('GET', '/api/health');
      out(body);
      process.exit(body.ok ? 0 : 1);
      break;
    }
    case 'tools': {
      const groups = rest[0] ? `?groups=${encodeURIComponent(rest[0])}` : '';
      const { body } = await request('GET', `/api/tools${groups}`);
      if (!body.ok) { out(body); process.exit(1); }
      // Names only by default: the schemas are long and rarely what is wanted.
      out(rest.includes('--full')
        ? body.tools
        : { count: body.tools.length, total: body.total, groups: body.groups, names: body.tools.map((t) => t.name) });
      break;
    }

    case 'instructions': {
      const { body } = await request('GET', '/api/instructions');
      process.stdout.write(`${body.instructions ?? JSON.stringify(body)}\n`);
      break;
    }
    case 'selftest': {
      const { body } = await request('POST', '/api/selftest', {
        keepProject: rest.includes('--keep'),
      });
      if (!body.ok && !body.result) { out(body); process.exit(1); }
      const report = body.result ?? body;
      printSelfTest(report);
      process.exit(report.ok ? 0 : 1);
      break;
    }
    case 'cleanup': {
      const { body } = await request('POST', '/api/selftest/cleanup', {
        projectId: rest[0],
      });
      out(body);
      process.exit(body.ok ? 0 : 1);
      break;
    }
    case 'audit': {
      const limit = Number(rest[0]) || 20;
      const { body } = await request('GET', `/api/audit?limit=${limit}`);
      if (!body.ok) { out(body); process.exit(1); }
      for (const entry of body.entries) {
        const when = new Date(entry.at).toLocaleTimeString();
        const mark = entry.undone ? 'UNDONE ' : entry.ok ? '       ' : 'FAILED ';
        process.stdout.write(
          `#${String(entry.index).padStart(4)} ${when} ${mark}${entry.summary ?? entry.tool}\n`,
        );
      }
      break;
    }
    case 'undo': {
      const index = Number(rest[0]);
      if (!Number.isInteger(index)) {
        out({ ok: false, error: 'usage: undo <auditIndex>  (see: wh-bridge audit)' });
        process.exit(1);
      }
      const { body } = await request('POST', '/api/undo', { index });
      out(body);
      process.exit(body.ok ? 0 : 1);
      break;
    }
    case 'call': {
      const tool = rest[0];
      if (!tool) { out({ ok: false, error: 'usage: call <tool> [json]' }); process.exit(1); }
      let args = {};
      try {
        args = parseArgs(rest.slice(1));
      } catch (err) {
        out({ ok: false, error: err.message });
        process.exit(1);
      }
      const { body } = await request('POST', '/api/call', { tool, args, client: 'wh-bridge-cli' });
      out(body);
      process.exit(body.ok ? 0 : 1);
      break;
    }
    default:
      process.stdout.write(
        'wh-bridge — talk to the local Writers Hoard AI bridge\n\n'
        + '  health                     is the port up, is the app open\n'
        + '  tools [groups] [--full]    the catalogue, optionally filtered\n'
        + '  instructions               the briefing a model receives\n'
        + '  selftest [--keep]          exercise everything on a scratch project\n'
        + '  cleanup [projectId]        delete scratch projects a --keep run left\n'
        + '  audit [n]                  what the bridge has changed, newest first\n'
        + '  undo <auditIndex>          turn one of those changes back\n'
        + '  call <tool> [args]         run one tool\n\n'
        + 'Arguments take key=value pairs, a JSON blob, or @file.json:\n'
        + '  call wh_search query=quokka limit=5\n'
        + '  call wh_delete type=writing id=abc123\n',
      );
      process.exit(command ? 1 : 0);
  }
}

void main();
