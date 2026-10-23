import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isIpcChannelAllowedForRole } from '../electron/security';
import {
  createKeyStore,
  DEFAULT_KEY_ID,
  DEFAULT_KEY_LABEL,
  LAST_USED_THROTTLE_MS,
  MAX_ACTIVE_KEYS,
} from '../electron/aibridge/keys';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Main-process half of the named bridge keys: migration, auth of each key, revocation, usage throttling. */
export async function runAiBridgeKeysTests(temporaryDirectory: string): Promise<string[]> {
  const passed: string[] = [];
  const dir = path.join(temporaryDirectory, 'bridge-keys');
  await fs.mkdir(dir, { recursive: true });
  let clock = 1_000_000;
  const store = createKeyStore({ dir: () => dir, now: () => clock });

  // ---- Migration: the single token becomes the default key --------------------------------------
  const legacy = 'ab'.repeat(32);
  await fs.writeFile(path.join(dir, 'token'), `${legacy}\n`, 'utf8');
  const first = await store.list();
  assert(first.length === 1 && first[0].id === DEFAULT_KEY_ID && first[0].label === DEFAULT_KEY_LABEL, 'the legacy token did not become the default key');
  assert(first[0].isDefault && first[0].status === 'active', 'the default key is not flagged as such');
  assert(await store.getDefaultToken() === legacy, 'the legacy token changed during migration');
  const viaLegacy = await store.authenticate(legacy);
  assert(viaLegacy.ok && viaLegacy.id === DEFAULT_KEY_ID && viaLegacy.label === 'Principal', 'an already-configured client no longer authenticates');
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'keys.json'), 'utf8')) as { keys: Array<Record<string, unknown>> };
  assert(onDisk.keys.length === 1 && !('tokenHash' in onDisk.keys[0]), 'the default key must keep its token in the legacy file only');
  assert((await fs.readFile(path.join(dir, 'token'), 'utf8')).trim() === legacy, 'the legacy token file was rewritten');
  passed.push('bridge keys: legacy token migrates to the default key and keeps working');

  // ---- Create / list: the token is returned once and never stored in the clear -----------------
  clock += 5_000;
  const made = await store.create('  Claude   Desktop ');
  assert(made.ok, 'a valid key was refused');
  assert(made.key.label === 'Claude Desktop' && !made.key.isDefault && /^[a-f0-9]{64}$/.test(made.token), 'created key has the wrong shape');
  const keysJson = await fs.readFile(path.join(dir, 'keys.json'), 'utf8');
  assert(!keysJson.includes(made.token), 'a key token reached the disk in the clear');
  assert(keysJson.includes('tokenHash'), 'the key hash was not stored');
  const listing = JSON.stringify(await store.list());
  assert(!listing.includes(made.token) && !listing.includes('tokenHash') && !listing.includes(legacy), 'listing leaks secrets');
  assert((await store.list()).length === 2, 'the new key is not listed');
  passed.push('bridge keys: a new key shows its token once; only its hash is stored');

  // ---- Auth of each key --------------------------------------------------------------------------
  const second = await store.create('Script');
  assert(second.ok, 'second key refused');
  const a = await store.authenticate(made.token);
  const b = await store.authenticate(second.token);
  assert(a.ok && a.label === 'Claude Desktop' && b.ok && b.label === 'Script', 'each key must authenticate under its own label');
  assert((await store.authenticate(legacy)).ok, 'the default key stopped working after adding keys');
  const nope = await store.authenticate('f'.repeat(64));
  assert(!nope.ok && nope.code === 'bad-token', 'an unknown token was accepted');
  const empty = await store.authenticate('');
  assert(!empty.ok && empty.code === 'missing-token', 'an empty token was accepted');
  assert(!(await store.authenticate(made.token.slice(0, 63))).ok, 'a truncated token was accepted');
  passed.push('bridge keys: every active key authenticates under its own label; unknown tokens are refused');

  // ---- Label rules --------------------------------------------------------------------------------
  for (const bad of ['', '   ', 'x'.repeat(61), 42, null, undefined]) {
    const r = await store.create(bad);
    assert(!r.ok && r.code === 'bad-label', `bad label accepted: ${String(bad)}`);
  }
  const dup = await store.create('script');
  assert(!dup.ok && dup.code === 'duplicate-label', 'two active keys may not share a name');
  const withControl = await store.create('Tab\u0000\nbed');
  assert(withControl.ok && withControl.key.label === 'Tab bed', 'control characters reached the label');
  passed.push('bridge keys: label validation (empty, long, non-string, duplicate, control characters)');

  // ---- Rename -------------------------------------------------------------------------------------
  const renamed = await store.rename(made.key.id, 'Claude Desktop (portátil)');
  assert(renamed.ok && renamed.key.label === 'Claude Desktop (portátil)', 'rename failed');
  const ra = await store.authenticate(made.token);
  assert(ra.ok && ra.label === 'Claude Desktop (portátil)', 'the audit label did not follow the rename');
  assert((await store.rename(made.key.id, 'script')).ok === false, 'rename onto another active name accepted');
  assert((await store.rename('nope', 'x')).ok === false && (await store.rename(42, 'x')).ok === false, 'rename of a missing key accepted');
  assert((await store.rename(DEFAULT_KEY_ID, 'Cuenta personal')).ok, 'the default key could not be renamed');
  assert((await store.authenticate(legacy)).ok, 'renaming the default key broke it');
  passed.push('bridge keys: rename (including the default key) without touching tokens');

  // ---- lastUsedAt is throttled --------------------------------------------------------------------
  const store2 = createKeyStore({ dir: () => dir, now: () => clock });
  clock = 10_000_000;
  await store2.authenticate(second.token);
  const usedAt = (await store2.list()).find((k) => k.id === second.key.id)?.lastUsedAt;
  assert(usedAt === 10_000_000, 'first use not recorded');
  clock += LAST_USED_THROTTLE_MS - 1;
  await store2.authenticate(second.token);
  assert((await store2.list()).find((k) => k.id === second.key.id)?.lastUsedAt === usedAt, 'lastUsedAt written more often than the throttle');
  clock += 1;
  await store2.authenticate(second.token);
  assert((await store2.list()).find((k) => k.id === second.key.id)?.lastUsedAt === clock, 'lastUsedAt not refreshed after the throttle window');
  // Give the fire-and-forget write a moment, then check it survived a restart.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const restarted = createKeyStore({ dir: () => dir, now: () => clock });
  assert((await restarted.list()).find((k) => k.id === second.key.id)?.lastUsedAt === clock, 'lastUsedAt did not persist');
  passed.push('bridge keys: lastUsedAt is throttled to once a minute and persists');

  // ---- Revoke -------------------------------------------------------------------------------------
  const denied = await store.revoke(DEFAULT_KEY_ID);
  assert(!denied.ok && denied.code === 'default-key', 'the default key could be revoked');
  assert((await store.authenticate(legacy)).ok, 'default key stopped after a refused revoke');
  clock += 1000;
  const revoked = await store.revoke(second.key.id);
  assert(revoked.ok && revoked.key.status === 'revoked' && revoked.key.revokedAt === clock, 'revoke failed');
  const after = await store.authenticate(second.token);
  assert(!after.ok && after.code === 'revoked-token', 'a revoked key was still accepted');
  assert((await store.authenticate(made.token)).ok && (await store.authenticate(legacy)).ok, 'revoking one key affected the others');
  assert((await store.revoke(second.key.id)).ok, 'revoking twice should be harmless');
  assert((await store.revoke('nope')).ok === false, 'revoking a missing key accepted');
  // It holds across a restart.
  const again = createKeyStore({ dir: () => dir, now: () => clock });
  const afterRestart = await again.authenticate(second.token);
  assert(!afterRestart.ok && afterRestart.code === 'revoked-token', 'the revocation did not survive a restart');
  // A revoked key frees its name.
  assert((await store.create('Script')).ok, 'a revoked key still holds its name');
  passed.push('bridge keys: revoked key refused at once and after restart; others and the default unaffected');

  // ---- Default token rotation ---------------------------------------------------------------------
  const rotated = await store.regenerateDefaultToken();
  assert(rotated !== legacy && /^[a-f0-9]{64}$/.test(rotated), 'regenerate did not produce a new token');
  assert(!(await store.authenticate(legacy)).ok && (await store.authenticate(rotated)).ok, 'regenerate must swap the default token only');
  assert((await store.authenticate(made.token)).ok, 'regenerating the default token broke another key');
  passed.push('bridge keys: regenerating the main token leaves the other keys alone');

  // ---- Cap ----------------------------------------------------------------------------------------
  let active = (await store.list()).filter((k) => k.status === 'active').length;
  while (active < MAX_ACTIVE_KEYS) {
    const r = await store.create(`bulk ${active}`);
    assert(r.ok, 'creation under the cap refused');
    active += 1;
  }
  const over = await store.create('one too many');
  assert(!over.ok && over.code === 'too-many-keys', 'the active-key cap is not enforced');
  passed.push('bridge keys: active-key cap');

  // ---- Fresh install and unreadable keys.json -----------------------------------------------------
  const fresh = path.join(temporaryDirectory, 'bridge-keys-fresh');
  const freshStore = createKeyStore({ dir: () => fresh, now: () => clock });
  const mint = await freshStore.getDefaultToken();
  assert(/^[a-f0-9]{64}$/.test(mint) && (await freshStore.list()).length === 1, 'a fresh install must mint the default key');
  assert((await fs.readFile(path.join(fresh, 'token'), 'utf8')).trim() === mint, 'the minted token is not in the legacy file');
  const broken = path.join(temporaryDirectory, 'bridge-keys-broken');
  await fs.mkdir(broken, { recursive: true });
  await fs.writeFile(path.join(broken, 'token'), `${legacy}\n`, 'utf8');
  await fs.writeFile(path.join(broken, 'keys.json'), '{not json', 'utf8');
  const brokenStore = createKeyStore({ dir: () => broken, now: () => clock });
  assert((await brokenStore.authenticate(legacy)).ok, 'a corrupt keys.json locked the default key out');
  passed.push('bridge keys: fresh install and corrupt keys.json both fall back to a working default key');

  // ---- Cold-start concurrency -------------------------------------------------------------------
  // Both callers enter before the first disk read resolves. A successful
  // creation must remain usable, including after the app starts again.
  const concurrentDir = path.join(temporaryDirectory, 'bridge-keys-concurrent');
  const concurrentSeed = createKeyStore({ dir: () => concurrentDir, now: () => clock });
  await concurrentSeed.getDefaultToken();
  const concurrentStore = createKeyStore({ dir: () => concurrentDir, now: () => clock });
  const concurrentKeys = await Promise.all([
    concurrentStore.create('Cold client A'),
    concurrentStore.create('Cold client B'),
  ]);
  const concurrentRestart = createKeyStore({ dir: () => concurrentDir, now: () => clock });
  for (const key of concurrentKeys) {
    assert(key.ok, 'a concurrent cold-start key creation failed');
    assert((await concurrentStore.authenticate(key.token)).ok, 'a successful concurrent creation lost its key in memory');
    assert((await concurrentRestart.authenticate(key.token)).ok, 'a successful concurrent creation lost its key on disk');
  }
  passed.push('bridge keys: concurrent cold-start creations both remain usable after restart');

  // Auth can arrive from the listener while a key operation initializes the
  // store. Do not let a second initial read restore the pre-revocation record.
  const revokeDir = path.join(temporaryDirectory, 'bridge-keys-concurrent-revoke');
  const revokeSeed = createKeyStore({ dir: () => revokeDir, now: () => clock });
  await revokeSeed.getDefaultToken();
  const toRevoke = await revokeSeed.create('Cold revoke');
  assert(toRevoke.ok, 'could not prepare the cold-start revocation');
  const revokeStore = createKeyStore({ dir: () => revokeDir, now: () => clock });
  const [coldRevoke] = await Promise.all([
    revokeStore.revoke(toRevoke.key.id),
    revokeStore.authenticate(toRevoke.token),
  ]);
  assert(coldRevoke.ok, 'cold-start revocation failed');
  const laterAuth = await revokeStore.authenticate(toRevoke.token);
  assert(!laterAuth.ok && laterAuth.code === 'revoked-token', 'a concurrent initial authentication resurrected a revoked key');
  const revokeRestart = createKeyStore({ dir: () => revokeDir, now: () => clock });
  const laterRestartAuth = await revokeRestart.authenticate(toRevoke.token);
  assert(!laterRestartAuth.ok && laterRestartAuth.code === 'revoked-token', 'a concurrent initial authentication undid the persisted revocation');
  passed.push('bridge keys: cold-start authentication cannot undo a concurrent revocation');

  // ---- IPC policy ---------------------------------------------------------------------------------
  for (const channel of ['aibridge:listKeys', 'aibridge:createKey', 'aibridge:renameKey', 'aibridge:revokeKey']) {
    assert(isIpcChannelAllowedForRole(channel, 'main'), `the main window has no ${channel}`);
    assert(!isIpcChannelAllowedForRole(channel, 'quick-note'), `the quick-note window can use ${channel}`);
  }
  passed.push('bridge keys: IPC channels are main-window only');

  return passed;
}
