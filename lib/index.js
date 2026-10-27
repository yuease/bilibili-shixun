import os from 'node:os';
import path from 'node:path';
import { BilibiliApi } from './api.js';
import { BiliHttp, CookieJar } from './http.js';
import { LoginService } from './login.js';
import { RefreshRunner } from './refresh.js';
import { Scheduler } from './scheduler.js';
import { Store } from './store.js';
import { registerTools } from './tools.js';
import { installWebUi } from './webui.js';
import { PLUGIN_NAME } from './util.js';

export const name = PLUGIN_NAME;
export const inject = ['tools', 'commands'];

function resolveDataDir(config) {
  if (typeof config?.dataDir === 'string' && config.dataDir.trim()) return path.resolve(config.dataDir.trim());
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'bilibili-shixun');
}

/** @type {import('@deepseek-ai/cordis').Plugin} */
export function apply(ctx, config = {}) {
  const resolved = {
    dataDir: resolveDataDir(config),
    requestTimeoutMs: Math.max(3000, Number(config?.requestTimeoutMs) || 20000),
    requestIntervalMs: Math.max(0, Number(config?.requestIntervalMs) || 1000),
    maxItems: Math.max(100, Number(config?.maxItems) || 3000),
  };
  const logger = ctx.logger ?? console;
  const store = new Store({ dataDir: resolved.dataDir, logger, maxItems: resolved.maxItems });
  const http = new BiliHttp({
    jar: new CookieJar(),
    timeoutMs: resolved.requestTimeoutMs,
    intervalMs: resolved.requestIntervalMs,
    logger,
  });
  const api = new BilibiliApi({ http, logger });
  const login = new LoginService({ api, store, logger });
  const refresh = new RefreshRunner({ store, api, logger, config: resolved });
  const scheduler = new Scheduler({ store, refresh, logger });
  const env = { ctx, store, api, http, login, refresh, scheduler, logger, config: resolved };

  const ready = (async () => {
    await store.load();
    login.restore();
    if (store.account.status === 'valid' || store.account.cookies?.SESSDATA) {
      await login.check().catch((error) => {
        logger.warn?.(`[${PLUGIN_NAME}] 登录状态检查失败：${error?.code ?? error?.message ?? error}`);
      });
    }
    logger.info?.(`[${PLUGIN_NAME}] ready · data=${resolved.dataDir} · items=${store.items.length}`);
    scheduler.start();
    logger.info?.(
      `[${PLUGIN_NAME}] 定时采集${store.settings.collect.enabled ? `已启用（每 ${store.settings.collect.intervalMinutes} 分钟）` : '未启用'}`,
    );
  })().catch((error) => {
    logger.error?.(`[${PLUGIN_NAME}] 初始化失败：${error?.stack ?? error}`);
    throw error;
  });

  registerTools(ctx, env);
  installWebUi(ctx, env);

  if (ctx.commands) {
    const run = async (fn) => {
      try {
        await ready;
        return await fn();
      } catch (error) {
        return { kind: 'error', text: `B站拾讯操作未完成：${error?.detail ?? error?.message ?? error}` };
      }
    };
    ctx.effect(() =>
      ctx.commands.register({
        name: 'bilibili-login',
        description: '生成B站扫码登录二维码（二维码图片保存在本机，随后用 /bilibili-status 查看结果）',
        handler: () =>
          run(async () => {
            const { url, expires_at: expiresAt } = await login.begin();
            return {
              kind: 'success',
              text:
                `已在后台生成B站登录二维码（有效期至 ${expiresAt}）。\n` +
                `二维码地址：${url}\n` +
                `也可以在对话中让助手调用 bilibili_login 直接显示二维码图片；扫码确认后发送 /bilibili-status 查看结果。`,
            };
          }),
      }),
    );
    ctx.effect(() =>
      ctx.commands.register({
        name: 'bilibili-status',
        description: '查看B站登录状态、本地内容库与来源概况',
        handler: () =>
          run(async () => {
            const checked = await login.check();
            const account = login.status();
            const view = store.settingsView();
            const labels = { valid: '已登录', expired: '登录已失效', not_logged_in: '尚未登录' };
            const lines = [
              `B站：${labels[account.status] ?? '状态待确认'}${checked.unchecked ? '（本次未能联网校验）' : ''}`,
              account.uid ? `UID：${account.uid}${account.uname ? `（${account.uname}）` : ''}` : null,
              account.pending ? `二维码：${account.pending.state}，有效期至 ${account.pending.qr_expires_at}` : null,
              `长期来源：${view.source_status.sources.length} 个；关键词 ${view.settings.keywords.length}/${view.settings.max_keywords} 个；UP主 ${view.settings.ups.length} 个；关注来源${view.settings.following_enabled ? '已开启' : '关闭'}`,
              `本地内容：${view.data_status === 'available' ? '有可查询内容' : view.data_status}（保留 ${store.items.length} 条）`,
            ].filter(Boolean);
            return { kind: 'success', text: lines.join('\n') };
          }),
      }),
    );
    ctx.effect(() =>
      ctx.commands.register({
        name: 'bilibili-logout',
        description: '清除本机保存的B站登录凭据（不会退出其他设备）',
        handler: () =>
          run(async () => {
            await login.logout();
            return { kind: 'success', text: '已清除本机保存的B站登录凭据与“我的关注”来源开关；历史内容仍保留。' };
          }),
      }),
    );
    ctx.effect(() =>
      ctx.commands.register({
        name: 'bilibili-refresh',
        description: '采集全部已保存来源（最多等待 10 秒，其余在后台继续）',
        handler: () =>
          run(async () => {
            const job = await refresh.start({ waitSeconds: 10 });
            const running = job.status === 'running';
            const succeeded = (job.targets ?? []).filter((target) => target.status === 'ready').length;
            return {
              kind: running ? 'success' : 'success',
              text: running
                ? `采集仍在后台进行（已用 ${job.requests_used}/${job.request_budget} 次请求）。稍后用 /bilibili-status 或 bilibili_refresh_subscriptions(action="status") 查询。`
                : `采集${job.status === 'completed' ? '完成' : '结束但未成功'}：${succeeded}/${job.targets?.length ?? 0} 个来源成功，新增 ${(job.targets ?? []).reduce((sum, target) => sum + (target.new_items ?? 0), 0)} 条；数据完整性：${job.data_completeness}。`,
            };
          }),
      }),
    );
  }

  const timer = setInterval(() => {
    if (store.account.status === 'valid') {
      login.check().catch((error) => logger.warn?.(`[${PLUGIN_NAME}] 定期登录检查失败：${error?.code ?? error?.message}`));
    }
  }, 30 * 60 * 1000);
  timer.unref?.();

  ctx.effect(() => () => {
    clearInterval(timer);
    scheduler.stop();
    login.dispose();
  });
}
