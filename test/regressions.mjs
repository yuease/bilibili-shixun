import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.js';
import { registerTools } from '../lib/tools.js';
import { buildBriefing } from '../lib/briefing.js';
import { LoginService } from '../lib/login.js';
import { BiliHttp, CookieJar } from '../lib/http.js';
import { BilibiliApi } from '../lib/api.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const logger = { info() {}, warn() {}, error() {} };
async function storeFor(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shixun-regression-'));
  const store = new Store({ dataDir: dir, logger });
  await store.load();
  t.after(async () => { await store.flush(); await store.accountSaveChain; await fs.rm(dir, { recursive: true, force: true }); });
  return store;
}
function toolMap(store) {
  const definitions = new Map();
  const ctx = { effect: fn => fn(), tools: { register: def => { definitions.set(def.name, def); return () => {}; } } };
  registerTools(ctx, { ctx, store, config: {}, logger });
  return definitions;
}
async function addItems(store, key, count, age = 0, kind = 'keyword_search') {
  await store.mergeItems(Array.from({ length: count }, (_, i) => ({ id: `${key}-${i}`, title: `${key} ${i}`, body_text: '', content_type: 'video', published_at: new Date(Date.now() - age - i * 1000).toISOString() })), { kind, key });
  await store.recordSource(kind, key, { status: 'ready', last_success_at: new Date().toISOString() });
}
function mockFetch(t, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => { globalThis.fetch = original; });
}
async function loginFor(t) {
  const store = await storeFor(t);
  const http = new BiliHttp({ jar: new CookieJar(), intervalMs: 0, logger });
  const api = new BilibiliApi({ http, logger });
  const login = new LoginService({ api, store, logger });
  login.pending = { key: 'offline', state: 'waiting', expiresAt: Date.now() + 30000, polls: 0, errors: 0 };
  t.after(() => login.dispose());
  return { store, http, api, login };
}
const confirmedResponse = () => new Response(JSON.stringify({ code: 0, data: { code: 0, url: 'https://passport.bilibili.com/callback?SESSDATA=synthetic&bili_jct=synthetic' } }), { headers: { 'set-cookie': 'SESSDATA=synthetic; Path=/; Domain=.bilibili.com' } });
const navResponse = () => new Response(JSON.stringify({ code: 0, data: { isLogin: true, mid: 1001, uname: 'offline' } }));

test('tool add/remove/add uses a fresh operation and true retries survive reload', async t => {
  const s = await storeFor(t);
  let tool = toolMap(s).get('bilibili_update_subscriptions_and_preferences');
  const patch = { add_keywords: ['codex'], keyword_search_enabled: true };
  const firstArgs = { expected_version: s.settings.version, ...patch };
  const first = await tool.execute(firstArgs);
  assert.equal(first.ok, true);
  assert.equal((await tool.execute(firstArgs)).replayed, true);
  await tool.execute({ expected_version: s.settings.version, remove_keywords: ['codex'] });
  const thirdArgs = { expected_version: s.settings.version, ...patch };
  const third = await tool.execute(thirdArgs);
  assert.equal(third.ok, true);
  assert.equal(third.replayed, false);
  assert.deepEqual(s.settings.keywords, ['codex']);
  assert.equal(third.version, s.settings.version);
  const reloaded = new Store({ dataDir: s.dataDir, logger });
  await reloaded.load();
  tool = toolMap(reloaded).get('bilibili_update_subscriptions_and_preferences');
  const retried = await tool.execute(thirdArgs);
  assert.equal(retried.replayed, true);
  assert.equal(retried.change_id, third.change_id);
  assert.equal(reloaded.state.changes.length, 3);
});

test('failed combined settings patches leave memory, version, receipts and disk unchanged', async t => {
  const s = await storeFor(t);
  await s.save();
  const before = JSON.stringify(s.state);
  const disk = await fs.readFile(s.stateFile, 'utf8');
  for (const patch of [
    { add_keywords: ['codex'], interests: 'changed', following_enabled: true },
    { add_keywords: ['codex'], interests: 'changed', collect: { interval_minutes: 99 } },
    { add_keywords: ['a','b','c','d','e','f'], interests: 'changed' },
  ]) {
    await assert.rejects(s.updateSettings(patch, { expectedVersion: s.settings.version, requestId: JSON.stringify(patch) }));
    assert.equal(JSON.stringify(s.state), before);
    await s.save();
    assert.equal(await fs.readFile(s.stateFile, 'utf8'), disk);
  }
});

test('kind-only selectors expand all UPs and keywords, explicit/missing keys stay narrow', async t => {
  const s = await storeFor(t);
  await s.updateSettings({ add_ups: ['111','222'], add_keywords: ['A','B'], keyword_search_enabled: true }, { expectedVersion: s.settings.version });
  await addItems(s, '111', 1, 0, 'up_uploads'); await addItems(s, '222', 1, 0, 'up_uploads');
  await addItems(s, 'A', 1); await addItems(s, 'B', 1);
  const ups = s.queryItems({ sources: [{ kind: 'up_uploads' }] });
  assert.equal(ups.rows.length, 2);
  assert.equal(ups.requested_sources.length, 2);
  assert.equal(s.queryItems({ sources: [{ kind: 'keyword_search' }] }).rows.length, 2);
  assert.equal(s.queryItems({ sources: [{ kind: 'up_uploads', key: '222' }] }).rows[0].id, '222-0');
  const missing = s.queryItems({ sources: [{ kind: 'up_uploads', key: '999' }] });
  assert.equal(missing.rows.length, 0); assert.equal(missing.outcome, 'source_not_configured');
  assert.equal(s.resolveSelectors([{ kind: 'up_uploads' }, { kind: 'up_uploads', key: '111' }]).length, 2);
});

test('temporary kind selectors include every matching search rather than the first', async t => {
  const s = await storeFor(t);
  for (const keyword of ['A','B']) {
    await s.saveSearch({ id: keyword, keyword, created_at: new Date().toISOString() });
    await s.addTemporary([{ id: keyword, title: keyword }], { keyword, queryId: keyword });
  }
  assert.equal(s.queryItems({ sources: [{ kind: 'temporary_keyword' }] }).rows.length, 2);
});

test('briefing rotates all eligible sources before the candidate cap; public queries stay paginated', async t => {
  const s = await storeFor(t);
  await s.updateSettings({ add_keywords: ['A','B'], keyword_search_enabled: true, interests: 'B' }, { expectedVersion: s.settings.version });
  await addItems(s, 'A', 100); await addItems(s, 'B', 1, 200000);
  assert.equal(s.queryItems({ limit: 100 }).rows.length, 10);
  const brief = buildBriefing(s, { max_picks: 5 });
  assert.equal(brief.total_matches, 101);
  assert.equal(brief.candidate_count, 60);
  assert.ok(brief.picks.some(x => x.item_id === 'B-0'));
  assert.equal(brief.interest_ranking_applied, false);
  assert.equal(brief.interests, 'B');
  assert.equal(brief.selection_strategy, 'source_round_robin_then_recency');
  const narrow = buildBriefing(s, { sources: [{ kind: 'keyword_search', key: 'B' }] });
  assert.deepEqual(narrow.picks.map(x => x.item_id), ['B-0']);
});

test('briefing deduplicates cross-source items and honors explicit sources', async t => {
  const s = await storeFor(t);
  await s.updateSettings({ add_keywords: ['A','B'], keyword_search_enabled: true }, { expectedVersion: s.settings.version });
  await addItems(s, 'A', 2); await addItems(s, 'B', 1);
  await s.mergeItems([{ ...s.getItem('A-0') }], { kind: 'keyword_search', key: 'B' });
  const brief = buildBriefing(s, { max_picks: 10 });
  assert.equal(new Set(brief.picks.map(x => x.item_id)).size, 3);
  assert.equal(brief.picks.length, 3);
});

test('logout rejects late poll cookies from headers AND callback URL; duplicate polls are shared', async t => {
  const { store, http, login } = await loginFor(t);
  const arrived = deferred(), release = deferred(); let requests = 0;
  mockFetch(t, async () => { requests++; arrived.resolve(); await release.promise; return confirmedResponse(); });
  const poll = login.pollOnce();
  assert.equal(login.pollOnce(), poll);
  await arrived.promise; await login.logout(); release.resolve();
  assert.equal(await poll, 'cancelled');
  assert.equal(requests, 1); assert.equal(store.account.status, 'not_logged_in');
  assert.equal(http.jar.get('SESSDATA'), undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(store.accountFile, 'utf8')).cookies, {});
});

test('logout while confirming account identity does not commit the scan', async t => {
  const { store, http, login } = await loginFor(t);
  const arrived = deferred(), release = deferred();
  mockFetch(t, async url => {
    if (url.includes('/poll')) return confirmedResponse();
    arrived.resolve(); await release.promise; return navResponse();
  });
  const poll = login.pollOnce(); await arrived.promise; await login.logout(); release.resolve();
  assert.equal(await poll, 'cancelled');
  assert.equal(store.account.status, 'not_logged_in'); assert.equal(http.jar.get('SESSDATA'), undefined);
});

test('logout also invalidates an in-flight status check', async t => {
  const { store, login } = await loginFor(t);
  const arrived = deferred(), release = deferred();
  mockFetch(t, async () => { arrived.resolve(); await release.promise; return navResponse(); });
  const check = login.check(); await arrived.promise; await login.logout(); release.resolve();
  assert.equal((await check).cancelled, true); assert.equal(store.account.status, 'not_logged_in');
});

test('logout cancels queued poll requests before they reach the network', async t => {
  const { http, login } = await loginFor(t);
  const release = deferred(); let requests = 0;
  mockFetch(t, async () => { requests++; return confirmedResponse(); });
  http.chain = release.promise;
  const poll = login.pollOnce(); await login.logout(); release.resolve();
  assert.equal(await poll, 'cancelled'); assert.equal(requests, 0);
});

test('concurrent QR generation is shared and logout cancels its late result', async t => {
  const { login } = await loginFor(t);
  login.pending = null;
  const arrived = deferred(), release = deferred(); let requests = 0;
  mockFetch(t, async () => {
    requests++; arrived.resolve(); await release.promise;
    return new Response(JSON.stringify({ code: 0, data: { url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web', qrcode_key: 'offline' } }));
  });
  const begin = login.begin(); assert.equal(login.begin(), begin);
  const rejected = assert.rejects(begin, e => e.code === 'LOGIN_CANCELLED');
  await arrived.promise; await login.logout(); release.resolve(); await rejected;
  assert.equal(login.pending, null); assert.equal(requests, 1); assert.equal(login.timer, null);
});

test('unloading invalidates pending login results', async t => {
  const { store, http, login } = await loginFor(t);
  const arrived = deferred(), release = deferred();
  mockFetch(t, async () => { arrived.resolve(); await release.promise; return confirmedResponse(); });
  const poll = login.pollOnce(); await arrived.promise; login.dispose(); release.resolve();
  assert.equal(await poll, 'cancelled'); assert.equal(store.account.status, 'not_logged_in');
  assert.equal(http.jar.get('SESSDATA'), undefined);
});

test('normal successful scan persists credentials; subsequent logout clears disk and memory', async t => {
  const { store, http, login } = await loginFor(t);
  mockFetch(t, async url => url.includes('/poll') ? confirmedResponse() : navResponse());
  assert.equal(await login.pollOnce(), 'confirmed');
  assert.equal(store.loggedIn, true); assert.equal(store.account.uid, '1001');
  assert.equal(JSON.parse(await fs.readFile(store.accountFile, 'utf8')).status, 'valid');
  await login.logout();
  assert.deepEqual(JSON.parse(await fs.readFile(store.accountFile, 'utf8')).cookies, {});
  assert.equal(http.jar.get('SESSDATA'), undefined);
});
