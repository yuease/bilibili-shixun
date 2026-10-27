import { BiliError } from './errors.js';
import { sleep } from './util.js';

export const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

export class CookieJar {
  constructor(entries = {}) {
    this.cookies = new Map(Object.entries(entries).filter(([, value]) => typeof value === 'string' && value));
  }

  get(name) {
    return this.cookies.get(name);
  }

  set(name, value) {
    if (!name) return;
    if (value === undefined || value === null || value === '') this.cookies.delete(name);
    else this.cookies.set(name, String(value));
  }

  update(entries) {
    for (const [name, value] of Object.entries(entries ?? {})) this.set(name, value);
    return this;
  }

  get sessdata() {
    return this.get('SESSDATA') ?? '';
  }

  toString() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies);
  }

  absorbSetCookie(res) {
    const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of lines) {
      const match = /^\s*([^=;,\s]+)=([^;]*)/.exec(line);
      if (!match) continue;
      const [, name, value] = match;
      if (/^expires$/i.test(name)) continue;
      this.set(name, value === 'deleted' ? '' : value);
    }
  }
}

export class BiliHttp {
  constructor({ jar, timeoutMs = 20000, intervalMs = 1000, logger }) {
    this.jar = jar ?? new CookieJar();
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.chain = Promise.resolve();
    this.lastRequestAt = 0;
  }

  /** Serialize network calls and keep at least `intervalMs` between them. */
  gate(task) {
    const run = async () => {
      const wait = this.lastRequestAt + this.intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  async fetchRaw(url, { method = 'GET', headers = {}, body, timeoutMs, signal, cookie = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs ?? this.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const requestHeaders = { ...BROWSER_HEADERS, ...headers };
    if (cookie) {
      const cookieHeader = this.jar.toString();
      if (cookieHeader) requestHeaders.cookie = cookieHeader;
    }
    try {
      const res = await fetch(url, { method, headers: requestHeaders, body, signal: controller.signal, redirect: 'manual' });
      this.jar.absorbSetCookie(res);
      return res;
    } catch (error) {
      if (controller.signal.aborted) throw new BiliError('TIMEOUT');
      throw new BiliError('NETWORK', String(error?.message ?? error));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async json(url, options = {}) {
    const { signal, retries = 0, ...rest } = options;
    return this.gate(async () => {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const res = await this.fetchRaw(url, { ...rest, signal });
          if (res.status === 412 || res.status === 429) throw new BiliError('RATE_LIMITED', `HTTP ${res.status}`);
          if (!res.ok) throw new BiliError('HTTP_ERROR', `HTTP ${res.status}`);
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch {
            throw new BiliError('PARSE_ERROR');
          }
        } catch (error) {
          lastError = error;
          if (error?.code === 'TIMEOUT' || error?.code === 'NETWORK') {
            if (attempt < retries) {
              await sleep(600 * (attempt + 1));
              continue;
            }
          }
          throw error;
        }
      }
      throw lastError;
    });
  }

  /** Download bytes with browser headers, no account cookie, no redirect following. */
  async bytes(url, { maxBytes = 12 * 1024 * 1024, timeoutMs, signal } = {}) {
    const res = await this.fetchRaw(url, {
      cookie: false,
      signal,
      timeoutMs,
      headers: { referer: 'https://www.bilibili.com/', accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
    });
    if (res.status >= 300 && res.status < 400) throw new BiliError('UNSUPPORTED', '图片地址发生跳转，已拒绝下载');
    if (!res.ok) throw new BiliError('HTTP_ERROR', `HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) throw new BiliError('TOO_LARGE', `图片超过 ${maxBytes} 字节`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new BiliError('TOO_LARGE', `图片超过 ${maxBytes} 字节`);
    return { bytes: buffer, contentType: res.headers.get('content-type') ?? '' };
  }
}
