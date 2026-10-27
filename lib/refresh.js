import { BiliError } from './errors.js';
import { normalizeDynamic, normalizeVideo } from './items.js';
import { asArray, nowIso, randomId, sleep } from './util.js';

const LOGIN_KINDS = new Set(['up_dynamics', 'following_videos', 'following_dynamics']);

export class RefreshRunner {
  constructor({ store, api, logger, config }) {
    this.store = store;
    this.api = api;
    this.logger = logger;
    this.config = config;
    this.job = null;
    this.promise = null;
  }

  snapshot() {
    if (!this.job) {
      const last = this.store.state.stats.lastJob ?? null;
      return last ? { ...last, active: false } : { status: 'idle', active: false };
    }
    return { ...this.job, active: this.job.status === 'running' };
  }

  async start({ waitSeconds = 10, trigger = 'manual' } = {}) {
    const sources = this.store.configuredSources();
    if (!sources.length) throw new BiliError('NO_SOURCE');
    if (this.job?.status === 'running') {
      return this.wait(this.job, waitSeconds);
    }
    const job = {
      id: `job-${randomId()}`,
      status: 'running',
      started_at: nowIso(),
      finished_at: null,
      sources_total: sources.length,
      requests_used: 0,
      request_budget: Math.max(6, Math.min(24, sources.length * 2)),
      targets: [],
      warnings: [],
      data_completeness: 'unknown',
      data_complete: null,
      stop_reason: null,
      trigger,
    };
    this.job = job;
    this.store.state.stats.lastJob = job;
    await this.store.save().catch(() => {});
    this.promise = this.run(job, sources).catch(async (error) => {
      job.status = 'failed';
      job.finished_at = nowIso();
      job.error = String(error?.message ?? error);
      this.logger?.warn?.(`[bilibili-shixun] refresh failed: ${job.error}`);
      await this.store.save().catch(() => {});
    });
    return this.wait(job, waitSeconds);
  }

  async status({ waitSeconds = 0 } = {}) {
    if (!this.job) {
      // A persisted job from a previous process cannot still be running: it has
      // no live promise behind it, so it is reported as interrupted.
      const last = this.store.state.stats.lastJob ?? null;
      return last ? { ...last, active: false } : { status: 'idle', active: false };
    }
    const job = this.job;
    if (job.status === 'running') return this.wait(job, waitSeconds);
    return { ...job, active: false };
  }

  async wait(job, waitSeconds) {
    const seconds = Math.max(0, Math.min(20, Number(waitSeconds) || 0));
    if (job.status === 'running' && seconds > 0) {
      await Promise.race([this.promise ?? Promise.resolve(), sleep(seconds * 1000)]);
    }
    return { ...job, active: job.status === 'running' };
  }

  async run(job, sources) {
    const deadline = Date.now() + 60_000;

    for (const source of sources) {
      const target = {
        kind: source.kind,
        key: source.key,
        label: source.label,
        status: 'pending',
        pages: 0,
        candidates: 0,
        new_items: 0,
        updated_items: 0,
        stop_reason: null,
        error: null,
      };
      job.targets.push(target);
      if (job.requests_used >= job.request_budget) {
        target.status = 'skipped';
        target.stop_reason = 'request_budget';
        job.warnings.push(`${source.label}：达到本次请求预算，未采集。`);
        continue;
      }
      if (Date.now() > deadline) {
        target.status = 'skipped';
        target.stop_reason = 'time_budget';
        job.warnings.push(`${source.label}：达到本次时间预算，未采集。`);
        continue;
      }
      if (LOGIN_KINDS.has(source.kind) && !this.store.loggedIn) {
        target.status = this.store.account.status === 'expired' ? 'auth_expired' : 'auth_required';
        target.error = '需要先扫码登录B站';
        await this.store.recordSource(source.kind, source.key, {
          status: target.status,
          last_attempt_at: nowIso(),
          error: target.error,
          label: source.label,
        });
        job.warnings.push(`${source.label}：需要扫码登录，已跳过。`);
        continue;
      }

      job.requests_used += 0;
      target.status = 'running';
      await this.store.recordSource(source.kind, source.key, { status: 'running', last_attempt_at: nowIso(), label: source.label });

      try {
        const result = await this.collectSource(source, target, job, deadline);
        const merged = await this.store.mergeItems(result.items, source);
        target.new_items = merged.added;
        target.updated_items = merged.updated;
        target.candidates = result.items.length;
        target.status = 'ready';
        await this.store.recordSource(source.kind, source.key, {
          status: 'ready',
          label: source.label,
          last_attempt_at: target.started_at ?? nowIso(),
          last_success_at: nowIso(),
          pages: target.pages,
          items_seen: target.candidates,
          new_items: target.new_items,
          stop_reason: target.stop_reason,
          has_more: result.hasMore,
          coverage: target.stop_reason ? 'incomplete' : 'unknown',
          error: null,
        });
      } catch (error) {
        const code = error?.code ?? 'INTERNAL';
        target.status = code === 'AUTH_REQUIRED' || code === 'AUTH_EXPIRED' ? code.toLowerCase() : code === 'RATE_LIMITED' ? 'rate_limited' : 'failed';
        target.error = error?.detail || error?.message || String(error);
        job.warnings.push(`${source.label}：${target.error}`);
        await this.store.recordSource(source.kind, source.key, {
          status: target.status,
          label: source.label,
          last_attempt_at: nowIso(),
          error: target.error,
        });
        if (code === 'RATE_LIMITED') {
          job.warnings.push('B站触发风控：本次采集提前结束，请稍后再试。');
          break;
        }
      }
    }

    const failed = job.targets.filter((target) => ['failed', 'rate_limited', 'auth_required', 'auth_expired', 'skipped'].includes(target.status));
    const succeeded = job.targets.filter((target) => target.status === 'ready').length;
    const anyMore = job.targets.some(
      (target) =>
        target.stop_reason === 'batch_limit' ||
        target.stop_reason === 'candidate_cap' ||
        target.stop_reason === 'request_budget' ||
        target.stop_reason === 'time_budget',
    );
    job.data_completeness = failed.length || anyMore ? 'incomplete' : 'unknown';
    job.data_complete = failed.length || anyMore ? false : null;
    job.status = succeeded ? 'completed' : 'failed';
    job.finished_at = nowIso();
    job.stop_reason = failed.length ? 'partial_failure' : anyMore ? 'budget_exhausted' : 'finished';
    job.operation_finished = true;
    job.operation_succeeded = job.status === 'completed';
    this.store.state.stats.last_refresh_at = job.finished_at;
    this.store.state.stats.last_refresh_status = job.status;
    await this.store.save().catch(() => {});
    await this.store.flush();
  }

  async collectSource(source, target, job, deadline) {
    target.started_at = nowIso();
    const settings = this.store.settings;
    const maxPages = Math.max(1, Number(settings.collect.maxPagesPerSource) || 2);
    const maxCandidates = Math.max(5, Number(settings.collect.maxCandidatesPerSource) || 60);
    const items = [];
    let hasMore = false;
    let offset = '';
    let page = 1;

    const budgetCheck = () => {
      if (job.requests_used >= job.request_budget) return 'request_budget';
      if (Date.now() > deadline) return 'time_budget';
      if (items.length >= maxCandidates) return 'candidate_cap';
      return null;
    };

    while (true) {
      const blocked = budgetCheck();
      if (blocked) {
        target.stop_reason = blocked;
        break;
      }
      if (page > maxPages) {
        target.stop_reason = 'batch_limit';
        break;
      }
      job.requests_used += 1;
      let batch;
      if (source.kind === 'keyword_search') {
        batch = await this.api.searchVideos(source.key, { page: 1, pageSize: 30 });
        batch.items = batch.entries.map((entry) => normalizeVideo(entry, { sourceKind: source.kind, sourceKey: source.key })).filter(Boolean);
        batch.hasMore = false;
      } else if (source.kind === 'up_uploads') {
        batch = await this.api.upVideos(source.key, { page: 1, pageSize: 30 }).catch(async (error) => {
          // The app listing is the anonymous path; the web listing often needs a
          // logged-in cookie, so it is only a fallback when the app call is refused.
          if (error?.code === 'RATE_LIMITED' || error?.code === 'HTTP_ERROR' || error?.code === 'PARSE_ERROR') {
            return this.api.upVideosWeb(source.key, { page: 1, pageSize: 30 });
          }
          throw error;
        });
        batch.items = batch.entries.map((entry) => normalizeVideo(entry, { sourceKind: source.kind, sourceKey: source.key })).filter(Boolean);
        batch.hasMore = false;
      } else if (source.kind === 'up_dynamics') {
        batch = await this.api.upDynamics(source.key, { offset });
        batch.items = batch.entries.map((entry) => normalizeDynamic(entry, { sourceKind: source.kind, sourceKey: source.key })).filter(Boolean);
      } else if (source.kind === 'following_videos' || source.kind === 'following_dynamics') {
        batch = await this.api.followingDynamics({
          type: source.kind === 'following_videos' ? 'video' : 'all',
          offset,
        });
        const videosOnly = source.kind === 'following_videos';
        batch.items = batch.entries
          .map((entry) => normalizeDynamic(entry, { sourceKind: source.kind, sourceKey: source.key }))
          .filter((item) => item && (!videosOnly || item.content_type === 'video'));
      } else {
        throw new BiliError('INVALID_ARGUMENT', `未知来源类型 ${source.kind}`);
      }

      target.pages = page;
      items.push(...batch.items);
      hasMore = Boolean(batch.hasMore);
      offset = batch.offset ?? '';
      if (source.kind === 'keyword_search' || source.kind === 'up_uploads') {
        if (target.stop_reason === null) target.stop_reason = 'single_batch';
        break;
      }
      if (!hasMore) {
        if (target.stop_reason === null) target.stop_reason = 'end_of_feed';
        break;
      }
      page += 1;
      await sleep(300);
    }

    if (target.stop_reason === null && hasMore) target.stop_reason = 'batch_limit';
    return { items, hasMore };
  }
}
