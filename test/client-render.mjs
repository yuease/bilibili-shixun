#!/usr/bin/env node
/**
 * Renders the settings page without a browser or React install: the client
 * module is loaded with a minimal React stub, then the page is called with a
 * prepared snapshot so every branch of the render tree executes.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

await import(pathToFileURL(path.join(here, '..', 'client.js')).href);
assert.ok(captured, 'client module registers with the module loader');
assert.equal(captured.id, 'dsh-bilibili-shixun');

const stateValues = [];
let cursor = 0;
const React = {
  createElement(type, props, ...children) {
    const merged = { ...(props || {}) };
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type, props: merged };
  },
  useState(initial) {
    const index = cursor;
    cursor += 1;
    const value = index < stateValues.length ? stateValues[index] : typeof initial === 'function' ? initial() : initial;
    return [value, () => {}];
  },
  useEffect() {},
  useRef(value) {
    return { current: value };
  },
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  Fragment: 'fragment',
};

const plugin = captured.factory((request) => {
  assert.equal(request, 'react');
  return React;
});
assert.ok(plugin && typeof plugin.apply === 'function');

let component = null;
let label = null;
const ctx = {
  effect(fn) {
    return fn();
  },
  locale: {
    register() {
      return () => {};
    },
    bind() {
      return (key) => key;
    },
  },
  slots: {
    inject(_name, callback) {
      return callback();
    },
    register(options, Comp) {
      label = options.label();
      component = Comp;
      return () => {};
    },
  },
};
plugin.apply(ctx);

assert.equal(label, 'B站拾讯');
assert.ok(component, 'settings.section component registered');

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.props ? node.props.children : undefined);
}

const snapshot = {
  ok: true,
  version: 'v1',
  account: { status: 'valid', uid: '481963153', uname: 'yuease_', checked_at: new Date().toISOString(), pending: null },
  settings: {
    keywords: ['天文', '宇宙'],
    keyword_search_enabled: true,
    ups: [{ uid: '204877518', name: '太空科学站', include_dynamics: false }],
    following_enabled: true,
    interests: '天文摄影',
    filters: { excludeKeywords: [], minDurationSeconds: 0 },
    collect: { maxPagesPerSource: 2, maxCandidatesPerSource: 60 },
    max_keywords: 5,
  },
  sources: [
    {
      kind: 'keyword_search',
      key: '天文',
      label: '关键词 · 天文',
      availability: 'ready',
      status: 'ready',
      last_success_at: new Date().toISOString(),
      retained_count: 30,
      scan: { batches: 1, count: 30, stop_reason: 'single_batch', has_more: false },
    },
  ],
  data_status: 'available',
  collection_status: 'completed',
  job: { status: 'completed', data_completeness: 'unknown', warnings: [], targets: [], started_at: new Date().toISOString() },
  items: [
    {
      item_id: 'abc',
      title: '测试条目',
      author: '测试UP',
      published: '2026-10-27 18:00',
      url: 'https://www.bilibili.com/video/BV1xx',
      content_type: 'video',
      duration_seconds: 120,
      image_count: 0,
      sources: [{ kind: 'keyword_search', key: '天文', label: '关键词 · 天文' }],
    },
  ],
  counts: { retained_items: 64, temporary_items: 0, total_matches: 64 },
  schedule: {
    enabled: true,
    interval_minutes: 60,
    last_run_at: new Date().toISOString(),
    next_run_at: new Date(Date.now() + 3600000).toISOString(),
    due: false,
  },
  data_dir: 'C:/tmp/bilibili-shixun',
};

const draft = {
  keywords: ['天文', '宇宙'],
  ups: [{ uid: '204877518', name: '太空科学站', include_dynamics: false }],
  following_enabled: true,
  keyword_search_enabled: true,
  interests: '天文摄影',
  collect: { max_pages_per_source: 2, max_candidates_per_source: 60 },
};

// Page hook order: snap, draft, msg, busy, keyword, upUid, upName, qrNonce, now.
stateValues.push(snapshot, draft, null, '', '', '', '', 0, Date.now());
const tree = component({ close() {} });
cursor = 0;
const text = textOf(tree);

for (const expected of [
  'B站拾讯',
  '账号',
  '481963153',
  '订阅来源',
  '天文',
  '宇宙',
  '204877518',
  '关键词 · 天文',
  '最近内容',
  '测试条目',
  '64',
  '保存设置',
  '定时采集',
  '按时自动采集',
]) {
  assert.ok(text.includes(expected), `rendered page contains ${expected}`);
}
assert.ok(!text.includes('undefined'), 'no undefined leaked into the rendered page');

console.log('client render OK:', text.length, 'characters');
