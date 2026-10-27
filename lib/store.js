import crypto from 'node:crypto';
import path from 'node:path';
import { BiliError } from './errors.js';
import { asArray, ensureDir, hashId, nowIso, parseDateBound, readJson, startOfDay, writeJson } from './util.js';

export const MAX_KEYWORDS = 5;
export const MAX_TEMPORARY_ITEMS = 200;
export const TEMPORARY_TTL_MS = 24 * 3600 * 1000;
export const COLLECT_INTERVALS = [30, 60, 120, 360];

export const DEFAULT_SETTINGS = {
  version: '1',
  revision: 0,
  keywords: [],
  keywordSearchEnabled: false,
  ups: [],
  followingEnabled: false,
  interests: '',
  filters: { excludeKeywords: [], minDurationSeconds: 0 },
  collect: { maxPagesPerSource: 2, maxCandidatesPerSource: 60, enabled: false, intervalMinutes: 60 },
  updatedAt: null,
  lastChange: null,
};

const VERSION_FIELDS = ['keywords', 'keywordSearchEnabled', 'ups', 'followingEnabled', 'interests', 'filters', 'collect', 'revision'];

const PUBLIC_FIELDS = {
  keywordSearchEnabled: 'keyword_search_enabled',
  followingEnabled: 'following_enabled',
};

export function publicFieldName(field) {
  return PUBLIC_FIELDS[field] ?? field;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function computeVersion(settings) {
  const body = {};
  for (const field of VERSION_FIELDS) body[field] = settings[field] ?? null;
  const ordered = {};
  for (const key of Object.keys(body).sort()) ordered[key] = body[key];
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function normalizeSettings(raw) {
  const merged = {
    ...clone(DEFAULT_SETTINGS),
    ...(raw ?? {}),
    filters: { ...DEFAULT_SETTINGS.filters, ...(raw?.filters ?? {}) },
    collect: { ...DEFAULT_SETTINGS.collect, ...(raw?.collect ?? {}) },
  };
  merged.revision = Number.parseInt(merged.revision, 10) || 0;
  merged.keywords = asArray(merged.keywords)
    .filter((word) => typeof word === 'string' && word.trim())
    .map((word) => word.trim())
    .slice(0, MAX_KEYWORDS);
  merged.ups = asArray(merged.ups)
    .filter((up) => up && /^\d+$/.test(String(up.uid)))
    .map((up) => ({ uid: String(up.uid), name: String(up.name ?? '').slice(0, 100), dynamics: Boolean(up.dynamics) }));
  merged.followingEnabled = Boolean(merged.followingEnabled);
  merged.interests = String(merged.interests ?? '').slice(0, 10000);
  merged.collect.enabled = Boolean(merged.collect.enabled);
  merged.collect.intervalMinutes = COLLECT_INTERVALS.includes(Number(merged.collect.intervalMinutes))
    ? Number(merged.collect.intervalMinutes)
    : DEFAULT_SETTINGS.collect.intervalMinutes;
  merged.collect.maxPagesPerSource = Math.max(1, Math.min(5, Number(merged.collect.maxPagesPerSource) || 2));
  merged.collect.maxCandidatesPerSource = Math.max(5, Math.min(200, Number(merged.collect.maxCandidatesPerSource) || 60));
  if (!merged.keywords.length) merged.keywordSearchEnabled = false;
  merged.version = computeVersion(merged);
  return merged;
}

function itemMatchesTerms(item, terms) {
  if (!terms.length) return true;
  const haystack = [
    item.title ?? '',
    item.body_text ?? '',
    asArray(item.tags).join(' '),
    item.author ?? '',
    asArray(item.dynamic_contexts).map((context) => context?.text ?? '').join(' '),
  ]
    .join('\n')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export class Store {
  constructor({ dataDir, logger, maxItems = 3000 }) {
    this.dataDir = dataDir;
    this.stateFile = path.join(dataDir, 'state.json');
    this.accountFile = path.join(dataDir, 'account.json');
    this.logger = logger;
    this.maxItems = maxItems;
    this.state = {
      schema: 1,
      settings: normalizeSettings(DEFAULT_SETTINGS),
      items: [],
      temporary: [],
      sources: {},
      searches: {},
      requests: {},
      changes: [],
      stats: { total_added: 0, last_refresh_at: null, last_refresh_status: null, lastJob: null },
    };
    this.account = {
      status: 'not_logged_in',
      cookies: {},
      uid: null,
      uname: null,
      saved_at: null,
      checked_at: null,
    };
    this.index = new Map();
    this.saveChain = Promise.resolve();
    this.accountSaveChain = Promise.resolve();
    this.pendingSave = null;
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this;
    await ensureDir(this.dataDir);
    const state = await readJson(this.stateFile, null);
    if (state && typeof state === 'object') {
      this.state.settings = normalizeSettings(state.settings);
      this.state.items = asArray(state.items).filter((item) => item && item.id);
      this.state.temporary = asArray(state.temporary).filter((item) => item && item.id);
      this.state.sources = state.sources && typeof state.sources === 'object' ? state.sources : {};
      this.state.searches = state.searches && typeof state.searches === 'object' ? state.searches : {};
      this.state.requests = state.requests && typeof state.requests === 'object' ? state.requests : {};
      this.state.changes = asArray(state.changes).slice(-50);
      this.state.stats = { ...this.state.stats, ...(state.stats ?? {}) };
      const lastJob = this.state.stats.lastJob;
      if (lastJob && lastJob.status === 'running') {
        // Nothing can be running before a new process adopts the job.
        lastJob.status = 'failed';
        lastJob.stop_reason = 'interrupted';
        lastJob.finished_at = lastJob.finished_at ?? nowIso();
        lastJob.error = '插件重启，采集任务中断';
        this.state.stats.last_refresh_status = 'failed';
      }
    }
    for (const item of this.state.items) this.index.set(item.id, item);
    const account = await readJson(this.accountFile, null);
    if (account && typeof account === 'object') this.account = { ...this.account, ...account };
    this.loaded = true;
    return this;
  }

  get settings() {
    return this.state.settings;
  }

  get items() {
    return this.state.items;
  }

  accountState() {
    return {
      status: this.account.status ?? 'not_logged_in',
      uid: this.account.uid ?? null,
      uname: this.account.uname ?? null,
      saved_at: this.account.saved_at ?? null,
      checked_at: this.account.checked_at ?? null,
    };
  }

  get loggedIn() {
    return this.account.status === 'valid' && Boolean(this.account.cookies?.SESSDATA);
  }

  async setAccount(patch) {
    this.account = { ...this.account, ...patch };
    await this.saveAccount();
  }

  saveAccount() {
    const payload = clone(this.account);
    if (this.account.status !== 'valid') payload.cookies = {};
    const write = async () => {
      await ensureDir(this.dataDir);
      await writeJson(this.accountFile, payload);
      if (process.platform !== 'win32') {
        const fsp = await import('node:fs/promises');
        await fsp.chmod(this.accountFile, 0o600);
      }
    };
    const task = this.accountSaveChain.then(write, write);
    this.accountSaveChain = task.catch(() => {});
    return task;
  }

  /** Debounced, serialized persistence of state.json. */
  save() {
    if (this.pendingSave) return this.pendingSave;
    this.pendingSave = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSave = null;
        this.saveChain = this.saveChain.then(() => writeJson(this.stateFile, this.state)).then(resolve, reject);
      }, 60);
    });
    return this.pendingSave;
  }

  async flush() {
    await this.saveChain;
    if (this.pendingSave) await this.pendingSave.catch(() => {});
    await this.saveChain;
  }

  configuredSources() {
    const settings = this.state.settings;
    const sources = [];
    if (settings.keywordSearchEnabled) {
      for (const keyword of settings.keywords) {
        sources.push({ kind: 'keyword_search', key: keyword, label: `关键词 · ${keyword}` });
      }
    }
    for (const up of settings.ups) {
      const name = up.name ? `${up.name} · ${up.uid}` : up.uid;
      sources.push({ kind: 'up_uploads', key: up.uid, label: `UP投稿 · ${name}` });
      if (up.dynamics) sources.push({ kind: 'up_dynamics', key: up.uid, label: `UP动态 · ${name}` });
    }
    if (settings.followingEnabled) {
      const uid = this.account.uid ?? '';
      sources.push({ kind: 'following_videos', key: uid, label: `关注视频动态 · ${uid}` });
      sources.push({ kind: 'following_dynamics', key: uid, label: `关注综合动态 · ${uid}` });
    }
    return sources;
  }

  settingsView({ timezone = 'Asia/Shanghai' } = {}) {
    const settings = this.state.settings;
    return {
      version: settings.version,
      last_change_id: settings.lastChange?.id ?? null,
      updated_at: settings.updatedAt,
      configured: this.configuredSources().length > 0,
      settings: {
        keywords: [...settings.keywords],
        keyword_search_enabled: settings.keywordSearchEnabled,
        ups: settings.ups.map((up) => ({
          uid: up.uid,
          name: up.name || null,
          scope: up.dynamics ? 'both' : 'uploads',
          include_dynamics: Boolean(up.dynamics),
        })),
        following_enabled: settings.followingEnabled,
        interests: settings.interests,
        filters: clone(settings.filters),
        collect: clone(settings.collect),
        max_keywords: MAX_KEYWORDS,
      },
      source_status: this.sourceStatusRows({ timezone }),
      schedule: this.scheduleInfo(),
      collection_status: this.state.stats.lastJob?.status ?? 'not_started',
      data_status: this.dataStatus(),
      data_status_scope: 'enabled_long_term_sources',
      has_retained_results: this.state.items.length > 0,
      recent_changes: this.state.changes.slice(-5).map((change) => ({
        change_id: change.id,
        changed_fields: Object.keys(change.fields ?? {}).map(publicFieldName),
        created: change.at,
        undo_of: change.undo_of ?? null,
        origin: change.origin ?? null,
      })),
      account: this.accountState(),
      temporary_source_status: {
        retained_items: this.liveTemporary().length,
        ttl_hours: 24,
      },
    };
  }

  scheduleInfo() {
    const collect = this.state.settings.collect ?? DEFAULT_SETTINGS.collect;
    const intervalMinutes = collect.intervalMinutes || DEFAULT_SETTINGS.collect.intervalMinutes;
    const lastIso = this.state.stats.last_refresh_at ?? null;
    const last = lastIso ? Date.parse(lastIso) : null;
    const nextAt = collect.enabled ? (last ? last + intervalMinutes * 60000 : Date.now() + 60000) : null;
    return {
      enabled: Boolean(collect.enabled),
      interval_minutes: intervalMinutes,
      last_run_at: lastIso,
      next_run_at: nextAt ? new Date(nextAt).toISOString() : null,
      due: Boolean(collect.enabled && nextAt && nextAt <= Date.now()),
      runs_while: 'dsh_running',
    };
  }

  dataStatus() {
    const sources = this.configuredSources();
    if (!sources.length) return 'no_enabled_sources';
    const states = sources.map((source) => this.sourceState(source.kind, source.key));
    if (states.every((state) => !state || state.status === 'never')) return 'not_collected';
    const failed = states.filter((state) => state && ['failed', 'auth_required', 'auth_expired', 'rate_limited'].includes(state.status));
    const ready = states.filter((state) => state && state.status === 'ready');
    if (!ready.length && failed.length) return 'collection_failed';
    if (failed.length) return 'partial';
    if (ready.length && !this.state.items.length) return 'empty';
    return this.state.items.length ? 'available' : 'not_collected';
  }

  sourceKey(kind, key) {
    return `${kind}:${key ?? ''}`;
  }

  sourceState(kind, key) {
    return this.state.sources[this.sourceKey(kind, key)] ?? null;
  }

  async recordSource(kind, key, patch) {
    const id = this.sourceKey(kind, key);
    this.state.sources[id] = { ...(this.state.sources[id] ?? { kind, key, status: 'never' }), ...patch, updated_at: nowIso() };
    await this.save();
    return this.state.sources[id];
  }

  sourceStatusRows({ includeDisabled = false, timezone = 'Asia/Shanghai' } = {}) {
    const configured = this.configuredSources();
    const states = new Map(configured.map((source) => [`${source.kind}:${source.key}`, source]));
    if (includeDisabled) {
      for (const [id, state] of Object.entries(this.state.sources)) {
        if (!states.has(id)) states.set(id, { kind: state.kind, key: state.key, label: state.label ?? `${state.kind} · ${state.key}` });
      }
    }
    const rows = [...states.entries()].map(([id, source]) => {
      const state = this.state.sources[id] ?? null;
      const retained = this.state.items.filter((item) => asArray(item.sources).includes(id)).length;
      const status = state?.status ?? 'never';
      let availability = 'unknown';
      if (status === 'ready') availability = 'ready';
      else if (['failed', 'rate_limited', 'auth_required', 'auth_expired', 'running'].includes(status)) {
        availability = state?.last_success_at ? 'partial' : 'error';
      }
      return {
        kind: source.kind,
        key: source.key,
        label: source.label,
        availability,
        status,
        last_checked_at: state?.last_attempt_at ?? null,
        last_success_at: state?.last_success_at ?? null,
        retained_count: retained,
        error_code: state?.status && state.status !== 'ready' ? state.status.toUpperCase() : null,
        error_message: state?.error ?? null,
        scan: state?.stop_reason
          ? {
              batches: state.pages ?? 0,
              count: state.items_seen ?? 0,
              stop_reason: state.stop_reason,
              has_more: state.has_more ?? null,
              pagination_exhausted: state.stop_reason === 'end_of_feed',
            }
          : null,
      };
    });
    const truncated = rows.length > 50;
    return {
      sources: rows.slice(0, 50),
      sources_truncated: truncated,
      timezone,
      note: 'ready 只表示接口采集成功；scan 说明本次扫描范围，不能据此认定已覆盖全部更新。',
    };
  }

  getItem(itemId) {
    return this.index.get(String(itemId)) ?? null;
  }

  liveTemporary() {
    const cutoff = Date.now() - TEMPORARY_TTL_MS;
    return this.state.temporary.filter((item) => Date.parse(item.fetched_at ?? item.first_seen_at ?? 0) >= cutoff);
  }

  async addTemporary(entries, { keyword, queryId }) {
    const cutoff = Date.now() - TEMPORARY_TTL_MS;
    this.state.temporary = this.state.temporary.filter((item) => Date.parse(item.fetched_at ?? 0) >= cutoff);
    const existing = new Set(this.state.temporary.map((item) => `${item.query_id}:${item.id}`));
    for (const entry of entries) {
      if (existing.has(`${queryId}:${entry.id}`)) continue;
      this.state.temporary.push({
        ...entry,
        query_id: queryId,
        query_keyword: keyword,
        sources: [`temporary_keyword:${keyword}`],
        source_kind: 'temporary_keyword',
        source_key: keyword,
        fetched_at: nowIso(),
        first_seen_at: entry.first_seen_at ?? nowIso(),
      });
    }
    if (this.state.temporary.length > MAX_TEMPORARY_ITEMS) {
      this.state.temporary = this.state.temporary.slice(-MAX_TEMPORARY_ITEMS);
    }
    await this.save();
    return entries.length;
  }

  async mergeItems(entries, sourceRef) {
    let added = 0;
    let updated = 0;
    const seen = new Set();
    for (const entry of entries) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const existing = this.index.get(entry.id);
      const sourceTag = sourceRef ? `${sourceRef.kind}:${sourceRef.key ?? ''}` : null;
      if (!existing) {
        entry.sources = sourceTag ? [sourceTag] : [];
        entry.source_kind = sourceRef?.kind ?? null;
        entry.source_key = sourceRef?.key ?? null;
        entry.first_seen_at = nowIso();
        entry.collected_at = nowIso();
        this.state.items.unshift(entry);
        this.index.set(entry.id, entry);
        added += 1;
      } else {
        updated += 1;
        existing.sources = Array.from(new Set([...asArray(existing.sources), ...(sourceTag ? [sourceTag] : [])]));
        existing.collected_at = nowIso();
        for (const field of [
          'title',
          'body_text',
          'excerpt',
          'published_at',
          'duration_seconds',
          'author',
          'author_uid',
          'cover_url',
          'images',
          'image_count',
          'images_status',
          'attachments',
          'attachments_status',
          'dynamic_contexts',
          'repost_text',
          'forwarded_by',
          'original_published_at',
          'original_author_uid',
          'activity_type',
          'activity_url',
          'url',
        ]) {
          if (entry[field] !== undefined && entry[field] !== null && entry[field] !== '') existing[field] = entry[field];
        }
        // A re-fetch never renews the publication clock of an already-known item.
        if (existing.published_at && entry.published_at && Date.parse(entry.published_at) < Date.parse(existing.published_at)) {
          existing.published_at = entry.published_at;
        }
      }
    }
    if (this.state.items.length > this.maxItems) {
      const dropped = this.state.items.slice(this.maxItems);
      this.state.items = this.state.items.slice(0, this.maxItems);
      for (const item of dropped) this.index.delete(item.id);
    }
    this.state.stats.total_added += added;
    if (added || updated) await this.save();
    return { added, updated };
  }

  bumpVersion() {
    this.state.settings.revision = (Number.parseInt(this.state.settings.revision, 10) || 0) + 1;
    this.state.settings.version = computeVersion(this.state.settings);
    this.state.settings.updatedAt = nowIso();
    return this.state.settings.version;
  }

  rememberRequest(requestId, value) {
    if (!requestId) return;
    this.state.requests[requestId] = { at: nowIso(), value };
    const keys = Object.keys(this.state.requests);
    if (keys.length > 200) {
      for (const key of keys.slice(0, keys.length - 200)) delete this.state.requests[key];
    }
  }

  recallRequest(requestId) {
    if (!requestId) return null;
    return this.state.requests[requestId]?.value ?? null;
  }

  async updateSettings(patch, { expectedVersion, requestId, origin = 'bot' }) {
    const cached = this.recallRequest(requestId);
    if (cached) return { ...cached, replayed: true };
    if (String(expectedVersion ?? '') !== this.state.settings.version) {
      throw new BiliError('SETTINGS_CONFLICT', `当前 version 为 ${this.state.settings.version}`);
    }
    const settings = clone(this.state.settings);
    const changes = {};

    const addKeywords = asArray(patch.add_keywords).map((word) => String(word).trim()).filter(Boolean);
    const removeKeywords = asArray(patch.remove_keywords).map((word) => String(word).trim()).filter(Boolean);
    if (addKeywords.length || removeKeywords.length) {
      let keywords = [...settings.keywords];
      for (const word of addKeywords) {
        if (!keywords.includes(word)) keywords.push(word);
      }
      keywords = keywords.filter((word) => !removeKeywords.includes(word));
      if (keywords.length > MAX_KEYWORDS) throw new BiliError('INVALID_ARGUMENT', `长期关键词最多 ${MAX_KEYWORDS} 个`);
      if (JSON.stringify(keywords) !== JSON.stringify(settings.keywords)) {
        changes.keywords = { before: settings.keywords, after: keywords };
        settings.keywords = keywords;
      }
      if (!settings.keywords.length && settings.keywordSearchEnabled) {
        changes.keywordSearchEnabled = { before: true, after: false };
        settings.keywordSearchEnabled = false;
      }
    }

    if (typeof patch.interests === 'string' && patch.interests !== settings.interests) {
      changes.interests = { before: settings.interests, after: patch.interests.slice(0, 10000) };
      settings.interests = patch.interests.slice(0, 10000);
    }

    if (typeof patch.keyword_search_enabled === 'boolean' && patch.keyword_search_enabled !== settings.keywordSearchEnabled) {
      if (patch.keyword_search_enabled && !settings.keywords.length) {
        throw new BiliError('INVALID_ARGUMENT', '没有长期关键词时不能开启关键词来源');
      }
      changes.keywordSearchEnabled = { before: settings.keywordSearchEnabled, after: patch.keyword_search_enabled };
      settings.keywordSearchEnabled = patch.keyword_search_enabled;
    }

    const addUps = asArray(patch.add_ups)
      .map((up) => (typeof up === 'string' || typeof up === 'number' ? { uid: String(up) } : up))
      .filter((up) => up && /^\d+$/.test(String(up.uid)))
      .map((up) => ({ uid: String(up.uid), name: String(up.name ?? '').slice(0, 100), dynamics: Boolean(up.include_dynamics) }));
    const removeUps = asArray(patch.remove_ups)
      .map((up) => String(typeof up === 'object' ? up?.uid : up))
      .filter(Boolean);
    if (addUps.length || removeUps.length) {
      let ups = settings.ups.map((up) => ({ ...up }));
      for (const up of addUps) {
        const existing = ups.find((row) => row.uid === up.uid);
        if (existing) {
          if (up.name) existing.name = up.name;
          if (up.dynamics) existing.dynamics = true;
        } else {
          ups.push(up);
        }
      }
      ups = ups.filter((up) => !removeUps.includes(up.uid));
      if (ups.length > 32) throw new BiliError('INVALID_ARGUMENT', '最多 32 个UP主来源');
      if (JSON.stringify(ups) !== JSON.stringify(settings.ups)) {
        changes.ups = { before: settings.ups, after: ups };
        settings.ups = ups;
      }
    }

    if (typeof patch.following_enabled === 'boolean' && patch.following_enabled !== settings.followingEnabled) {
      if (patch.following_enabled && !this.loggedIn) throw new BiliError('AUTH_REQUIRED', '开启关注来源需要先扫码登录B站');
      changes.followingEnabled = { before: settings.followingEnabled, after: patch.following_enabled };
      settings.followingEnabled = patch.following_enabled;
    }

    if (patch.collect && typeof patch.collect === 'object') {
      const collect = { ...settings.collect };
      if (patch.collect.max_pages_per_source !== undefined) {
        collect.maxPagesPerSource = Math.max(1, Math.min(5, Number(patch.collect.max_pages_per_source) || collect.maxPagesPerSource));
      }
      if (patch.collect.max_candidates_per_source !== undefined) {
        collect.maxCandidatesPerSource = Math.max(5, Math.min(200, Number(patch.collect.max_candidates_per_source) || collect.maxCandidatesPerSource));
      }
      if (typeof patch.collect.enabled === 'boolean') collect.enabled = patch.collect.enabled;
      if (patch.collect.interval_minutes !== undefined) {
        const interval = Number(patch.collect.interval_minutes);
        if (!COLLECT_INTERVALS.includes(interval)) {
          throw new BiliError('INVALID_ARGUMENT', `interval_minutes 只能是 ${COLLECT_INTERVALS.join(' / ')}`);
        }
        collect.intervalMinutes = interval;
      }
      if (JSON.stringify(collect) !== JSON.stringify(settings.collect)) {
        changes.collect = { before: settings.collect, after: collect };
        settings.collect = collect;
      }
    }

    if (!Object.keys(changes).length) {
      return { ok: true, version: settings.version, changed: false, change_id: settings.lastChange?.id ?? null, changed_fields: [] };
    }

    this.state.settings = settings;
    const version = this.bumpVersion();
    const change = {
      id: `chg-${hashId(nowIso(), version, String(Math.random()))}`,
      at: nowIso(),
      origin,
      action: 'update',
      fields: changes,
    };
    settings.lastChange = { id: change.id, at: change.at, version, fields: Object.keys(changes).map(publicFieldName) };
    this.state.changes.push(change);
    if (this.state.changes.length > 50) this.state.changes = this.state.changes.slice(-50);
    const result = { ok: true, version, changed: true, change_id: change.id, changed_fields: Object.keys(changes).map(publicFieldName) };
    this.rememberRequest(requestId, result);
    await this.save();
    return result;
  }

  async undoChange({ changeId, expectedVersion, requestId }) {
    const cached = this.recallRequest(requestId);
    if (cached) return { ...cached, replayed: true };
    if (String(expectedVersion ?? '') !== this.state.settings.version) {
      throw new BiliError('SETTINGS_CONFLICT', `当前 version 为 ${this.state.settings.version}`);
    }
    const change = this.state.changes.find((row) => row.id === changeId);
    if (!change) throw new BiliError('NOT_FOUND', '没有找到该变更编号');
    if (change.action === 'undo') throw new BiliError('SETTINGS_UNDO_CONFLICT', '不能撤销一次撤销操作');
    const settings = this.state.settings;
    const restored = {};
    for (const [field, pair] of Object.entries(change.fields ?? {})) {
      if (JSON.stringify(settings[field]) !== JSON.stringify(pair.after)) {
        throw new BiliError('SETTINGS_UNDO_CONFLICT', `字段 ${field} 在此之后已被修改`);
      }
      restored[field] = pair.before;
    }
    if (!Object.keys(restored).length) throw new BiliError('INVALID_ARGUMENT', '该变更没有可撤销字段');
    Object.assign(settings, restored);
    if (!settings.keywords.length) settings.keywordSearchEnabled = false;
    const version = this.bumpVersion();
    const record = {
      id: `chg-${hashId(nowIso(), version, String(Math.random()))}`,
      at: nowIso(),
      origin: 'undo',
      action: 'undo',
      undo_of: changeId,
      fields: Object.fromEntries(
        Object.entries(restored).map(([field, value]) => [field, { before: change.fields[field].after, after: value }]),
      ),
    };
    settings.lastChange = { id: record.id, at: record.at, version, fields: Object.keys(restored).map(publicFieldName) };
    this.state.changes.push(record);
    if (this.state.changes.length > 50) this.state.changes = this.state.changes.slice(-50);
    const result = {
      ok: true,
      version,
      changed: true,
      change_id: record.id,
      undone: changeId,
      restored_fields: Object.keys(restored).map(publicFieldName),
    };
    this.rememberRequest(requestId, result);
    await this.save();
    return result;
  }

  saveSearch(record) {
    this.state.searches[record.id] = record;
    const now = Date.now();
    for (const [id, value] of Object.entries(this.state.searches)) {
      if (now - Date.parse(value.created_at) > TEMPORARY_TTL_MS) delete this.state.searches[id];
    }
    const remaining = Object.entries(this.state.searches).sort((a, b) => Date.parse(b[1].created_at) - Date.parse(a[1].created_at));
    for (const [id] of remaining.slice(200)) delete this.state.searches[id];
    return this.save();
  }

  getSearch(id) {
    const record = this.state.searches[String(id)];
    if (!record) return null;
    if (Date.now() - Date.parse(record.created_at) > TEMPORARY_TTL_MS) return null;
    return record;
  }

  resolveTimeRange(timeRange, timezone) {
    const zone = timeRange?.timezone || timezone || 'Asia/Shanghai';
    const period = timeRange?.period;
    const now = new Date();
    if (period && (timeRange?.start || timeRange?.end)) {
      throw new BiliError('INVALID_ARGUMENT', 'period 不能与 start/end 混用');
    }
    if (period === 'today') {
      return { start: startOfDay(zone, now).toISOString(), end: null, label: '今天', timezone: zone };
    }
    if (period === 'last_3_days') {
      return { start: new Date(now.getTime() - 72 * 3600 * 1000).toISOString(), end: now.toISOString(), label: '最近三天', timezone: zone };
    }
    const start = timeRange?.start ? parseDateBound(timeRange.start, zone) : null;
    const end = timeRange?.end ? parseDateBound(timeRange.end, zone) : null;
    if (timeRange?.start && !start) throw new BiliError('INVALID_ARGUMENT', 'start 不是可识别的时间');
    if (timeRange?.end && !end) throw new BiliError('INVALID_ARGUMENT', 'end 不是可识别的时间');
    if (start && end && start >= end) throw new BiliError('INVALID_ARGUMENT', 'start 必须早于 end');
    return {
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      label: start || end ? `${start ? start.toISOString() : '…'} ~ ${end ? end.toISOString() : '…'}` : null,
      timezone: zone,
    };
  }

  resolveSelectors(requested) {
    const configured = this.configuredSources();
    const list = asArray(requested);
    if (!list.length) return configured.map((source) => ({ ...source, requested: false }));
    const expanded = list.flatMap((selector) => {
      const kind = String(selector?.kind ?? '');
      const key = selector?.key === undefined ? undefined : String(selector.key);
      if (kind === 'temporary_keyword') {
        const matches = Object.keys(this.state.searches)
          .map((id) => this.state.searches[id])
          .filter((search) => key === undefined || search.keyword === key)
          .map((search) => ({ kind: 'temporary_keyword', key: search.keyword, label: `临时视频搜索 · ${search.keyword}`, queryId: search.id }));
        return matches.length ? matches.map((match) => ({ ...match, requested: true })) : [{ kind, key: key ?? null, label: `临时视频搜索 · ${key ?? ''}`, missing: true, requested: true }];
      }
      const matches = configured.filter((source) => source.kind === kind && (key === undefined || source.key === key));
      if (!matches.length) {
        return { kind, key: key ?? null, label: `${kind}${key ? ` · ${key}` : ''}`, missing: true, requested: true };
      }
      return matches.map((match) => ({ ...match, requested: true }));
    });
    const seen = new Set();
    return expanded.filter((selector) => {
      const key = JSON.stringify([selector.kind, selector.key, selector.queryId]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  selectorState(selector, range, retainedCount) {
    const state = this.sourceState(selector.kind, selector.key);
    if (!state || state.status === 'never' || !state.last_success_at) return 'not_collected';
    if (['auth_required', 'auth_expired'].includes(state.status)) {
      return retainedCount ? 'failed_with_retained' : 'collection_failed';
    }
    if (['failed', 'rate_limited'].includes(state.status)) {
      return retainedCount ? 'failed_with_retained' : 'collection_failed';
    }
    if (range?.start && Date.parse(state.last_success_at) < Date.parse(range.start)) {
      return 'snapshot_older_than_range';
    }
    return retainedCount ? 'ready' : 'collected_empty';
  }

  queryItems(params, { timezone = 'Asia/Shanghai', paginate = true } = {}) {
    const zone = params?.timezone || timezone;
    const range = this.resolveTimeRange(params?.time_range, zone);
    const startMs = range.start ? Date.parse(range.start) : null;
    const endMs = range.end ? Date.parse(range.end) : null;
    const selectors = this.resolveSelectors(params?.sources);
    const temporarySelectors = selectors.filter((selector) => selector.kind === 'temporary_keyword');
    const selectorTags = new Set();
    for (const selector of selectors) {
      if (selector.missing) continue;
      selectorTags.add(`${selector.kind}:${selector.key ?? ''}`);
    }
    const terms = asArray(params?.terms)
      .map((term) => String(term).trim().toLowerCase())
      .filter(Boolean);
    const types = new Set(asArray(params?.content_types).map((type) => String(type)));
    const exclude = asArray(this.settings.filters.excludeKeywords).map((term) => String(term).toLowerCase()).filter(Boolean);
    const minDuration = Number(this.settings.filters.minDurationSeconds) || 0;
    const hasImages = params?.has_images;
    const maxDuration = Number(params?.max_duration_seconds) || 0;

    let pool = this.state.items;
    if (temporarySelectors.length) {
      const queries = new Set(temporarySelectors.map((selector) => selector.queryId).filter(Boolean));
      const temporary = this.liveTemporary().filter((item) => !queries.size || queries.has(item.query_id));
      pool = [...pool, ...temporary];
    }
    // Explicit selectors that resolve to no known source must never widen the
    // query to every retained item.
    const scopeEmpty = selectors.some((selector) => selector.requested) && selectorTags.size === 0;

    const rows = [];
    let missingPublicationTime = 0;
    for (const item of pool) {
      if (scopeEmpty) break;
      const tags = asArray(item.sources);
      if (selectorTags.size && !tags.some((tag) => selectorTags.has(tag))) continue;
      const publishedMs = item.published_at ? Date.parse(item.published_at) : null;
      if (startMs !== null || endMs !== null) {
        if (publishedMs === null) {
          missingPublicationTime += 1;
          continue;
        }
        if (startMs !== null && publishedMs < startMs) continue;
        if (endMs !== null && publishedMs >= endMs) continue;
      }
      if (types.size && !types.has(item.content_type)) continue;
      if (hasImages === true && !(item.image_count > 0)) continue;
      if (hasImages === false && !(item.image_count === 0 && item.images_status === 'known')) continue;
      if (maxDuration && item.content_type === 'video' && item.duration_seconds && item.duration_seconds > maxDuration) continue;
      if (minDuration && item.duration_seconds && item.duration_seconds < minDuration) continue;
      if (exclude.length) {
        const haystack = `${item.title ?? ''}\n${item.body_text ?? ''}`.toLowerCase();
        if (exclude.some((term) => haystack.includes(term))) continue;
      }
      if (!itemMatchesTerms(item, terms)) continue;
      rows.push(item);
    }
    rows.sort((left, right) => {
      const a = left.published_at ? Date.parse(left.published_at) : -Infinity;
      const b = right.published_at ? Date.parse(right.published_at) : -Infinity;
      if (a !== b) return b - a;
      return String(right.first_seen_at ?? '').localeCompare(String(left.first_seen_at ?? ''));
    });

    const limit = Math.max(1, Math.min(10, Number(params?.limit) || 5));
    const page = Math.max(1, Number(params?.page) || 1);
    const slice = paginate ? rows.slice((page - 1) * limit, page * limit) : rows;

    const requestedSources = selectors.map((selector) => {
      if (selector.missing) {
        return { selector: { kind: selector.kind, key: selector.key }, state: 'not_configured', matched_sources: [] };
      }
      const retainedCount = rows.filter((item) => asArray(item.sources).includes(`${selector.kind}:${selector.key ?? ''}`)).length;
      const state =
        selector.kind === 'temporary_keyword'
          ? retainedCount
            ? 'ready'
            : 'temporary_search_required'
          : this.selectorState(selector, range, retainedCount);
      return {
        selector: { kind: selector.kind, key: selector.key },
        state,
        matched_sources: [
          {
            kind: selector.kind,
            key: selector.key,
            state,
            retained_count: retainedCount,
            last_success_at: this.sourceState(selector.kind, selector.key)?.last_success_at ?? null,
          },
        ],
      };
    });

    const usable = new Set(['ready', 'collected_empty']);
    const failedStates = new Set(['collection_failed', 'failed_with_retained']);
    const anyFailed = requestedSources.some((row) => failedStates.has(row.state));
    let sourceScopeStatus = 'ready';
    if (!requestedSources.length || requestedSources.every((row) => !usable.has(row.state) && !failedStates.has(row.state))) {
      sourceScopeStatus = 'unavailable';
    } else if (requestedSources.some((row) => !usable.has(row.state))) {
      sourceScopeStatus = 'partial';
    }

    let outcome;
    if (rows.length) outcome = 'found';
    else if (anyFailed) outcome = 'collection_failed';
    else if (!requestedSources.length) outcome = 'source_not_configured';
    else if (requestedSources.every((row) => row.state === 'not_collected')) outcome = 'not_collected';
    else if (requestedSources.every((row) => row.state === 'not_configured')) outcome = 'source_not_configured';
    else if (requestedSources.every((row) => row.state === 'snapshot_older_than_range')) outcome = 'stale_data';
    else if (requestedSources.some((row) => usable.has(row.state))) outcome = 'no_match';
    else outcome = 'source_unavailable';

    const reasons = ['retained_sampling'];
    for (const row of requestedSources) {
      if (row.state === 'collection_failed' || row.state === 'failed_with_retained') reasons.push('source_failure');
      if (row.state === 'snapshot_older_than_range') reasons.push('source_not_collected_in_requested_period');
      if (row.state === 'not_collected') reasons.push('source_never_succeeded');
    }
    if (missingPublicationTime) reasons.push('missing_publication_time');

    return {
      outcome,
      source_scope_status: sourceScopeStatus,
      rows: slice,
      total_matches: rows.length,
      page,
      has_more: page * limit < rows.length,
      requested_sources: requestedSources,
      range,
      missing_publication_count: missingPublicationTime,
      coverage: {
        scope: 'retained_allowed_data',
        timezone: zone,
        start: range.start,
        end: range.end,
        boundary: 'start_inclusive_end_exclusive',
        as_of: nowIso(),
        limited_sampling: true,
        completeness: anyFailed ? 'incomplete' : 'unknown',
        reasons: Array.from(new Set(reasons)),
        note: '仅查询已采集并保留的内容，无法确认全部更新已覆盖。',
      },
    };
  }
}
