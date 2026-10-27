import { BiliError } from './errors.js';
import { itemView } from './format.js';
import { asArray } from './util.js';

const PREFIX = '/bilibili-shixun';
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function fail(response, error) {
  const code = error?.code ?? 'INTERNAL';
  const status =
    code === 'SETTINGS_CONFLICT' || code === 'SETTINGS_UNDO_CONFLICT'
      ? 409
      : code === 'AUTH_REQUIRED' || code === 'AUTH_EXPIRED'
        ? 401
        : code === 'NO_SOURCE'
          ? 400
          : code === 'INVALID_ARGUMENT'
            ? 400
            : 500;
  sendJson(response, status, {
    ok: false,
    error: { code, message: error?.detail ?? error?.message ?? String(error) },
  });
}

function headerOf(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

/** Same-origin only: a browser page from another site must not drive this plugin. */
function allowRequest(request, response) {
  const site = headerOf(request, 'sec-fetch-site').toLowerCase();
  if (site === 'cross-site') {
    sendJson(response, 403, { ok: false, error: { code: 'CROSS_ORIGIN', message: 'cross-origin blocked' } });
    return false;
  }
  const origin = headerOf(request, 'origin').trim();
  if (origin === 'null') {
    sendJson(response, 403, { ok: false, error: { code: 'CROSS_ORIGIN', message: 'cross-origin blocked' } });
    return false;
  }
  if (!origin) return true;
  const host = headerOf(request, 'host').trim();
  try {
    if (!host || new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
      sendJson(response, 403, { ok: false, error: { code: 'CROSS_ORIGIN', message: 'cross-origin blocked' } });
      return false;
    }
  } catch {
    sendJson(response, 403, { ok: false, error: { code: 'CROSS_ORIGIN', message: 'cross-origin blocked' } });
    return false;
  }
  return true;
}

async function readJsonBody(request) {
  const declared = Number(headerOf(request, 'content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BiliError('INVALID_ARGUMENT', '请求体过大');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BiliError('INVALID_ARGUMENT', '请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new BiliError('INVALID_ARGUMENT', '请求体不是合法 JSON 对象');
  }
}

function statePayload(env) {
  const { store, login, refresh, config } = env;
  const view = store.settingsView();
  const recent = store.queryItems({ limit: 12, page: 1 }, { timezone: 'Asia/Shanghai' });
  return {
    ok: true,
    version: view.version,
    account: login.status(),
    settings: {
      ...view.settings,
      interests: view.settings.interests,
    },
    sources: view.source_status.sources,
    data_status: view.data_status,
    collection_status: view.collection_status,
    schedule: env.scheduler ? env.scheduler.snapshot() : view.schedule,
    recent_changes: view.recent_changes,
    job: refresh.snapshot(),
    items: recent.rows.map((item) => itemView(item, 'Asia/Shanghai')),
    counts: {
      retained_items: store.items.length,
      temporary_items: view.temporary_source_status.retained_items,
      total_matches: recent.total_matches,
    },
    last_refresh_at: store.state.stats.last_refresh_at,
    data_dir: config.dataDir,
  };
}

export function installWebUi(ctx, env) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = [];
      const route = (kind, path, handler) => {
        const dispose = host.webServer.register({
          kind,
          path,
          handler: async (request, response) => {
            if (!allowRequest(request, response)) return;
            try {
              await handler(request, response);
            } catch (error) {
              fail(response, error);
            }
          },
        });
        disposers.push(dispose);
      };

      route('exact', `${PREFIX}/api/state`, async (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        sendJson(response, 200, statePayload(env));
      });

      route('exact', `${PREFIX}/api/settings`, async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        const body = await readJsonBody(request);
        const patch = {
          add_keywords: asArray(body.add_keywords).slice(0, 5),
          remove_keywords: asArray(body.remove_keywords).slice(0, 5),
          add_ups: asArray(body.add_ups).slice(0, 10),
          remove_ups: asArray(body.remove_ups).slice(0, 10),
        };
        if (typeof body.following_enabled === 'boolean') patch.following_enabled = body.following_enabled;
        if (typeof body.interests === 'string') patch.interests = body.interests;
        if (typeof body.keyword_search_enabled === 'boolean') patch.keyword_search_enabled = body.keyword_search_enabled;
        if (body.collect && typeof body.collect === 'object') patch.collect = body.collect;
        const result = await env.store.updateSettings(patch, {
          expectedVersion: body.expected_version,
          requestId: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          origin: 'web',
        });
        sendJson(response, 200, { ...result, state: statePayload(env) });
      });

      route('exact', `${PREFIX}/api/refresh`, async (request, response) => {
        if (request.method === 'POST') {
          const job = await env.refresh.start({ waitSeconds: 0 });
          return sendJson(response, 200, { ok: true, job, state: statePayload(env) });
        }
        if (request.method === 'GET') {
          const job = await env.refresh.status({ waitSeconds: 0 });
          return sendJson(response, 200, { ok: true, job, state: statePayload(env) });
        }
        return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
      });

      route('exact', `${PREFIX}/api/login`, async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        const pending = await env.login.begin();
        sendJson(response, 200, {
          ok: true,
          expires_at: pending.expires_at,
          reused: pending.reused,
          qr_url: pending.url,
          state: statePayload(env),
        });
      });

      route('exact', `${PREFIX}/api/login/qr`, async (request, response) => {
        if (request.method !== 'GET') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        const png = env.login.pending?.png;
        if (!png) return sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: '没有待扫码的二维码' } });
        response.writeHead(200, {
          'content-type': 'image/png',
          'content-length': png.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(png);
      });

      route('exact', `${PREFIX}/api/logout`, async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        await env.login.logout();
        sendJson(response, 200, { ok: true, state: statePayload(env) });
      });

      route('exact', `${PREFIX}/api/account/check`, async (request, response) => {
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: { code: 'METHOD' } });
        const checked = await env.login.check();
        sendJson(response, 200, { ok: true, checked, state: statePayload(env) });
      });

      return () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
            /* route already gone */
          }
        }
      };
    }, 'bilibili-shixun: web ui routes');
  });
}
