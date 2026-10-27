#!/usr/bin/env node
/**
 * Offline checks for dsh-bilibili-shixun. No network and no DSH process needed.
 * Run: node test/smoke.mjs        (add BILIBILI_LIVE=1 to include one live search)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildBriefing } from '../lib/briefing.js';
import { BiliError } from '../lib/errors.js';
import { itemView } from '../lib/format.js';
import { contentImageUrl, normalizeDynamic, normalizeVideo, originalImageUrl } from '../lib/items.js';
import { RefreshRunner } from '../lib/refresh.js';
import { Scheduler, computeNextRunAt } from '../lib/scheduler.js';
import { Store } from '../lib/store.js';
import { BiliHttp, CookieJar } from '../lib/http.js';
import { BilibiliApi } from '../lib/api.js';
import { qrPng } from '../lib/qr.js';

const logger = { info() {}, warn() {}, error() {} };
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const testRoot = path.dirname(fileURLToPath(import.meta.url));
for (const entry of await fs.readdir(testRoot)) {
  if (entry.startsWith('.tmp-bilibili-shixun-')) await fs.rm(path.join(testRoot, entry), { recursive: true, force: true });
}
const dataDir = await fs.mkdtemp(path.join(testRoot, '.tmp-bilibili-shixun-'));
const store = new Store({ dataDir, logger, maxItems: 100 });
await store.load();

const videoEntry = {
  bvid: 'BV1Lr421K7B9',
  aid: 1406422809,
  title: '测试 <em>天文</em> 视频',
  author: '测试UP',
  mid: 204877518,
  description: '关于宇宙与天文望远镜的简介',
  pubdate: Math.floor(Date.now() / 1000) - 3600,
  duration: '12:34',
  pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
  tag: '天文,宇宙',
};

await test('normalizeVideo maps bvid, duration and tags', () => {
  const item = normalizeVideo(videoEntry, { sourceKind: 'keyword_search', sourceKey: '天文' });
  assert.equal(item.content_type, 'video');
  assert.equal(item.duration_seconds, 754);
  assert.deepEqual(item.tags, ['天文', '宇宙']);
  assert.match(item.url, /BV1Lr421K7B9$/);
  assert.deepEqual(item.sources, ['keyword_search:天文']);
  assert.equal(itemView(item).title, '测试 天文 视频');
});

await test('dynamic repost keeps original author/attribution and drops rejected images', () => {
  const card = {
    id_str: '1234567890',
    type: 'DYNAMIC_TYPE_DRAW',
    modules: { module_author: { name: '转发者', mid: 1, pub_ts: 1790000000 }, module_dynamic: { desc: { text: '转发' } } },
    orig: {
      id_str: '9876543210',
      type: 'DYNAMIC_TYPE_DRAW',
      modules: {
        module_author: { name: '原作者', mid: 2, pub_ts: 1780000000 },
        module_dynamic: {
          desc: { text: '原文' },
          major: { opus: { title: '图集', pics: [{ url: 'https://i0.hdslb.com/bfs/new_dyn/a.jpg@200w' }, { url: 'https://i0.hdslb.com/bfs/face/no.jpg' }] } },
        },
      },
    },
  };
  const item = normalizeDynamic(card, { sourceKind: 'following_dynamics', sourceKey: '2' });
  assert.equal(item.author, '原作者');
  assert.equal(item.forwarded_by, '转发者');
  assert.equal(item.image_count, 1);
  assert.equal(item.images[0], 'https://i0.hdslb.com/bfs/new_dyn/a.jpg@200w');
  assert.equal(item.original_published_at, new Date(1780000000 * 1000).toISOString());
  assert.equal(contentImageUrl('https://evil.example/bfs/album/a.jpg'), null);
  assert.equal(originalImageUrl('https://i0.hdslb.com/bfs/new_dyn/a.jpg@200w'), 'https://i0.hdslb.com/bfs/new_dyn/a.jpg');
});

await test('settings are versioned, idempotent and undoable', async () => {
  const before = store.settingsView();
  const updated = await store.updateSettings(
    { add_keywords: ['天文'], keyword_search_enabled: true },
    { expectedVersion: before.version, requestId: 'req-1' },
  );
  assert.equal(updated.changed, true);
  assert.notEqual(updated.version, before.version);

  const replay = await store.updateSettings(
    { add_keywords: ['天文'], keyword_search_enabled: true },
    { expectedVersion: before.version, requestId: 'req-1' },
  );
  assert.equal(replay.replayed, true);

  await assert.rejects(
    store.updateSettings({ add_keywords: ['宇宙'] }, { expectedVersion: before.version, requestId: 'req-2' }),
    (error) => error instanceof BiliError && error.code === 'SETTINGS_CONFLICT',
  );

  const undone = await store.undoChange({ changeId: updated.change_id, expectedVersion: updated.version, requestId: 'req-3' });
  assert.deepEqual(undone.restored_fields.sort(), ['keyword_search_enabled', 'keywords']);
  assert.deepEqual(store.settingsView().settings.keywords, []);
  await assert.rejects(
    store.undoChange({ changeId: updated.change_id, expectedVersion: undone.version, requestId: 'req-4' }),
    (error) => error.code === 'SETTINGS_UNDO_CONFLICT' || error.code === 'NOT_FOUND',
  );
});

await test('retrieval filters by source, AND terms and time', async () => {
  const version = store.settingsView().version;
  await store.updateSettings(
    { add_keywords: ['天文'] },
    { expectedVersion: version, requestId: 'req-5' },
  );
  // The previous undo removed the keyword source; enabling it is required for selection.
  await store.updateSettings(
    { keyword_search_enabled: true },
    { expectedVersion: store.settingsView().version, requestId: 'req-6' },
  );
  await store.mergeItems(
    [
      normalizeVideo(videoEntry, { sourceKind: 'keyword_search', sourceKey: '天文' }),
      normalizeVideo({ ...videoEntry, bvid: 'BV1xxxxxxxxx', title: '无关游戏视频', description: '游戏攻略', pubdate: 1 }, { sourceKind: 'keyword_search', sourceKey: '天文' }),
    ],
    { kind: 'keyword_search', key: '天文' },
  );
  await store.recordSource('keyword_search', '天文', {
    status: 'ready',
    last_attempt_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
  });
  const all = store.queryItems({ sources: [{ kind: 'keyword_search', key: '天文' }], limit: 5, time_range: { period: 'last_3_days' } });
  assert.equal(all.outcome, 'found');
  assert.equal(all.total_matches, 1);
  assert.equal(all.requested_sources[0].state, 'ready');

  const miss = store.queryItems({ sources: [{ kind: 'keyword_search', key: '天文' }], terms: ['不存在的词'], limit: 5 });
  assert.equal(miss.outcome, 'no_match');

  const wrongSource = store.queryItems({ sources: [{ kind: 'up_uploads', key: '1' }], limit: 5 });
  assert.equal(wrongSource.total_matches, 0);
  assert.equal(wrongSource.outcome, 'source_not_configured');
});

await test('briefing ranks round-robin and never claims to be a finished report', () => {
  const briefing = buildBriefing(store, { max_picks: 3, time_range: { period: 'last_3_days' } });
  assert.equal(briefing.operation, 'briefing_material');
  assert.equal(briefing.picks.length, 1);
  assert.match(briefing.guidance, /不是结论/);
});

await test('refresh refuses when no sources are enabled', async () => {
  const empty = new Store({ dataDir: path.join(dataDir, 'empty'), logger });
  await empty.load();
  const runner = new RefreshRunner({ store: empty, api: { searchVideos: async () => ({ entries: [] }) }, logger, config: {} });
  await assert.rejects(runner.start({}), (error) => error.code === 'NO_SOURCE');
});

await test('scheduled collection fires when overdue and rejects unknown intervals', async () => {
  assert.equal(computeNextRunAt(null, 60, 1000), 1000);
  assert.equal(computeNextRunAt(new Date(0).toISOString(), 30, 1000), 30 * 60 * 1000);

  const scheduled = new Store({ dataDir: path.join(dataDir, 'scheduled'), logger });
  await scheduled.load();
  await assert.rejects(
    scheduled.updateSettings({ collect: { interval_minutes: 45 } }, { expectedVersion: scheduled.settingsView().version, requestId: 'r-int' }),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
  await scheduled.updateSettings(
    { collect: { enabled: true, interval_minutes: 30 } },
    { expectedVersion: scheduled.settingsView().version, requestId: 'r-sched' },
  );
  assert.equal(scheduled.settingsView().settings.collect.enabled, true);
  assert.equal(scheduled.settingsView().settings.collect.intervalMinutes, 30);

  scheduled.state.stats.last_refresh_at = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  let fired = 0;
  const runner = { job: null, start: async () => { fired += 1; return { id: 'job-test', sources_total: 2 }; } };
  const scheduler = new Scheduler({ store: scheduled, refresh: runner, logger });
  scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fired, 1);
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.due, true);
  scheduler.stop();
  const afterStop = fired;
  scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fired, afterStop, 'a stopped scheduler does not fire');
});

await test('QR PNG is a valid 8-bit greyscale PNG', async () => {
  const png = qrPng('https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=test', { scale: 4 });
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);
  assert.ok(png.length > 500);
  const width = png.readUInt32BE(16);
  assert.equal(width, png.readUInt32BE(20));
  assert.ok(width >= 100);
});

if (process.env.BILIBILI_LIVE === '1') {
  await test('live anonymous Bilibili search returns video candidates', async () => {
    const http = new BiliHttp({ jar: new CookieJar(), logger, intervalMs: 800 });
    const api = new BilibiliApi({ http, logger });
    const result = await api.searchVideos('天文', { page: 1, pageSize: 20 });
    assert.ok(result.entries.length > 0);
    const item = normalizeVideo(result.entries[0]);
    assert.equal(item.content_type, 'video');
  });
}

await store.flush();
await fs.rm(dataDir, { recursive: true, force: true });
console.log(`\n${passed} checks passed${process.env.BILIBILI_LIVE === '1' ? ' (including live search)' : ''}.`);
