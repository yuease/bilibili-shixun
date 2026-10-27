import { nowIso } from './util.js';

const CHECK_MS = 60_000;

/** Earliest due instant for a completed run plus its interval. */
export function computeNextRunAt(lastIso, intervalMinutes, now = Date.now()) {
  const intervalMs = Math.max(1, Number(intervalMinutes) || 60) * 60_000;
  const last = lastIso ? Date.parse(lastIso) : Number.NaN;
  if (!Number.isFinite(last)) return now;
  return last + intervalMs;
}

/**
 * Interval collection while DSH runs. Mirrors the AstrBot original's
 * `collection.enabled` + `interval_minutes` (30/60/120/360): an overdue slot is
 * caught up shortly after start, then the timer follows the last run time.
 */
export class Scheduler {
  constructor({ store, refresh, logger }) {
    this.store = store;
    this.refresh = refresh;
    this.logger = logger;
    this.timer = null;
    this.stopped = false;
    this.lastError = null;
    this.startedAt = null;
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.startedAt = nowIso();
    this.arm(15_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  arm(delayMs) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), Math.max(250, delayMs));
    this.timer.unref?.();
  }

  tick() {
    this.timer = null;
    if (this.stopped) return;
    const collect = this.store.settings.collect;
    if (!collect.enabled) {
      // Idle check: enabling the schedule takes effect without an event hook.
      this.arm(CHECK_MS);
      return;
    }
    const next = computeNextRunAt(this.store.state.stats.last_refresh_at, collect.intervalMinutes);
    const wait = next - Date.now();
    if (wait > 1000) {
      this.arm(Math.min(wait, CHECK_MS));
      return;
    }
    if (this.refresh.job?.status === 'running') {
      this.arm(30_000);
      return;
    }
    this.fire();
  }

  async fire() {
    try {
      const job = await this.refresh.start({ waitSeconds: 0, trigger: 'schedule' });
      this.logger?.info?.(`[bilibili-shixun] 定时采集已启动：${job.id ?? ''}（${job.sources_total ?? 0} 个来源）`);
    } catch (error) {
      this.lastError = {
        at: nowIso(),
        code: error?.code ?? 'INTERNAL',
        message: error?.detail ?? error?.message ?? String(error),
      };
      this.logger?.warn?.(`[bilibili-shixun] 定时采集未启动：${this.lastError.code}`);
    }
    this.arm(CHECK_MS);
  }

  snapshot() {
    const collect = this.store.settings.collect;
    const nextAt = collect.enabled
      ? computeNextRunAt(this.store.state.stats.last_refresh_at, collect.intervalMinutes)
      : null;
    return {
      enabled: Boolean(collect.enabled),
      interval_minutes: collect.intervalMinutes,
      last_run_at: this.store.state.stats.last_refresh_at ?? null,
      next_run_at: nextAt ? new Date(Math.max(nextAt, Date.now())).toISOString() : null,
      due: Boolean(collect.enabled && nextAt !== null && nextAt <= Date.now()),
      active: Boolean(collect.enabled && !this.stopped),
      running: this.refresh.job?.status === 'running',
      last_error: this.lastError,
      runs_while: 'dsh_running',
      note: '定时采集只在 DSH 运行期间执行；错过的时间点会在下次启动后补跑一次。',
    };
  }
}
