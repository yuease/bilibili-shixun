import crypto from 'node:crypto';
import { BiliError } from './errors.js';
import { DM_PARAMS, signQuery, wbiKeysFromNav } from './wbi.js';
import { asArray } from './util.js';

const API = 'https://api.bilibili.com';
const PASSPORT = 'https://passport.bilibili.com';
const APP_API = 'https://app.bilibili.com';
const APP_KEY = ['1d8b6e7d45233436', '560c52ccd288fed045859ed18bffd973'];
const APP_HEADERS = {
  'user-agent': 'Mozilla/5.0 BiliDroid/7.30.0 (bbcallen@gmail.com) os/android',
};

function appSign(params) {
  const ts = Math.floor(Date.now() / 1000);
  const all = { ...params, appkey: APP_KEY[0], ts };
  const text = Object.keys(all)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(all[key])}`)
    .join('&');
  const digest = crypto.createHash('md5').update(`${text}${APP_KEY[1]}`).digest('hex');
  return `${text}&sign=${digest}`;
}

const RATE_CODES = new Set([-352, -412, -509]);
const AUTH_CODES = new Set([-101, -400, -403]);

function wrapCode(payload, { auth = 'AUTH_REQUIRED' } = {}) {
  const code = Number(payload?.code);
  if (code === 0) return payload.data;
  if (AUTH_CODES.has(code)) throw new BiliError(auth, `Bilibili code ${code}`);
  if (RATE_CODES.has(code)) throw new BiliError('RATE_LIMITED', `Bilibili code ${code}`);
  if (code === -404) throw new BiliError('NOT_FOUND', 'Bilibili code -404');
  throw new BiliError('HTTP_ERROR', `Bilibili code ${code} ${payload?.message ?? ''}`.trim());
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export class BilibiliApi {
  constructor({ http, logger }) {
    this.http = http;
    this.logger = logger;
    this.wbi = null;
    this.publicReady = false;
  }

  /** Anonymous visitors still need buvid3/buvid4 or the space endpoints answer -352. */
  async ensurePublic() {
    if (this.publicReady && this.http.jar.get('buvid3')) return;
    const payload = await this.http.json(`${API}/x/frontend/finger/spi`);
    const data = payload?.data ?? {};
    if (data.b_3) this.http.jar.set('buvid3', data.b_3);
    if (data.b_4) this.http.jar.set('buvid4', data.b_4);
    this.publicReady = Boolean(this.http.jar.get('buvid3'));
  }

  async keys(force = false) {
    if (!force && this.wbi && Date.now() - this.wbi.fetchedAt < 6 * 3600 * 1000) return this.wbi;
    const payload = await this.http.json(`${API}/x/web-interface/nav`);
    const keys = wbiKeysFromNav(payload);
    if (!keys) throw new BiliError('PARSE_ERROR', 'wbi keys missing');
    this.wbi = keys;
    return keys;
  }

  async nav() {
    const payload = await this.http.json(`${API}/x/web-interface/nav`);
    const data = payload?.data ?? {};
    return {
      isLogin: Boolean(data.isLogin),
      uid: data.mid ? String(data.mid) : null,
      uname: data.uname ?? null,
      money: data.money ?? null,
      wbi: wbiKeysFromNav(payload),
    };
  }

  async searchVideos(keyword, { page = 1, pageSize = 20, timeRange } = {}) {
    await this.ensurePublic();
    const keys = await this.keys();
    const params = {
      keyword,
      search_type: 'video',
      order: 'pubdate',
      duration: '0',
      page,
      page_size: pageSize,
    };
    if (timeRange?.beginSeconds) params.pubtime_begin_s = timeRange.beginSeconds;
    if (timeRange?.endSeconds) params.pubtime_end_s = timeRange.endSeconds;
    const signed = signQuery(params, keys);
    const payload = await this.http.json(`${API}/x/web-interface/wbi/search/type?${signed}`);
    const data = payload?.data ?? {};
    const code = Number(payload?.code);
    if (code !== 0) wrapCode(payload);
    const result = data.result;
    const numResults = Number(data.numResults);
    const numPages = Number(data.numPages);
    const emptyEnvelope =
      !Array.isArray(result) &&
      Number.isFinite(numResults) &&
      numResults === 0 &&
      (numPages === 0 || Number.isNaN(numPages));
    if (!Array.isArray(result) && !emptyEnvelope) throw new BiliError('PARSE_ERROR', 'search result missing');
    const entries = Array.isArray(result) ? result.filter((row) => row && row.type === 'video') : [];
    return {
      entries,
      reportedTotal: Number.isFinite(numResults) ? numResults : null,
      hasMore: Number.isFinite(numPages) ? page < numPages : null,
    };
  }

  async upVideos(mid, { page = 1, pageSize = 30, cursor = 0 } = {}) {
    await this.ensurePublic();
    const params = {
      vmid: String(mid),
      ps: pageSize,
      order: 'pubdate',
      mobi_app: 'android',
      platform: 'android',
      build: 7300000,
    };
    if (cursor) params.cursor = cursor;
    const payload = await this.http.json(`${APP_API}/x/v2/space/archive/cursor?${appSign(params)}`, {
      headers: APP_HEADERS,
    });
    const data = wrapCode(payload);
    const entries = asArray(data.item)
      .filter((entry) => entry && (entry.bvid || entry.param))
      .map((entry) => ({
        bvid: entry.bvid,
        aid: entry.param,
        title: entry.title,
        author: entry.author,
        mid: String(mid),
        description: '',
        pubdate: entry.ctime,
        duration: entry.duration,
        pic: entry.cover,
        tag: '',
      }));
    const total = Number(data.count);
    return {
      entries,
      reportedTotal: Number.isFinite(total) ? total : null,
      hasMore: Boolean(data.has_next),
      cursor: data.next_cursor ?? null,
    };
  }

  /** Web WBI space listing (kept as a fallback when the app endpoint is unavailable). */
  async upVideosWeb(mid, { page = 1, pageSize = 30 } = {}) {
    await this.ensurePublic();
    const keys = await this.keys();
    const params = {
      mid: String(mid),
      ps: pageSize,
      pn: page,
      order: 'pubdate',
      platform: 'web',
      web_location: 1550101,
      order_avoided: 'true',
      ...DM_PARAMS,
    };
    const signed = signQuery(params, keys);
    const payload = await this.http.json(`${API}/x/space/wbi/arc/search?${signed}`);
    const data = wrapCode(payload);
    const list = data?.list ?? {};
    const entries = Array.isArray(list.vlist) ? list.vlist.filter(Boolean) : [];
    const total = Number(data?.page?.count);
    return {
      entries,
      reportedTotal: Number.isFinite(total) ? total : null,
      hasMore: Number.isFinite(total) ? page * pageSize < total : null,
    };
  }

  async dynamicsFeed(url) {
    await this.ensurePublic();
    const payload = await this.http.json(url);
    const data = wrapCode(payload);
    return {
      entries: Array.isArray(data?.items) ? data.items.filter(Boolean) : [],
      offset: data?.offset ?? null,
      hasMore: Boolean(data?.has_more),
    };
  }

  upDynamics(mid, { offset = '' } = {}) {
    return this.dynamicsFeed(
      `${API}/x/polymer/web-dynamic/v1/feed/space${query({
        host_mid: String(mid),
        offset,
        timezone_offset: -480,
        features: 'itemOpusStyle',
      })}`,
    );
  }

  followingDynamics({ type = 'all', offset = '' } = {}) {
    return this.dynamicsFeed(
      `${API}/x/polymer/web-dynamic/v1/feed/all${query({
        type,
        offset,
        page: 1,
        timezone_offset: -480,
        features: 'itemOpusStyle',
      })}`,
    );
  }

  async videoDetail(bvidOrAid) {
    const key = /^BV[0-9A-Za-z]+$/.test(bvidOrAid) ? `bvid=${encodeURIComponent(bvidOrAid)}` : `aid=${encodeURIComponent(bvidOrAid)}`;
    const payload = await this.http.json(`${API}/x/web-interface/view?${key}`);
    return wrapCode(payload);
  }

  async qrcodeGenerate() {
    const payload = await this.http.json(`${PASSPORT}/x/passport-login/web/qrcode/generate`);
    const data = wrapCode(payload, { auth: 'AUTH_REQUIRED' });
    if (typeof data?.url !== 'string' || typeof data?.qrcode_key !== 'string') {
      throw new BiliError('PARSE_ERROR', 'qrcode payload invalid');
    }
    return { url: data.url, qrcodeKey: data.qrcode_key };
  }

  /**
   * Poll once. Returns { state: 'waiting'|'scanned'|'expired'|'confirmed', message, url? }.
   * On success the cookie jar has already absorbed the credential cookies.
   */
  async qrcodePoll(qrcodeKey) {
    const payload = await this.http.json(
      `${PASSPORT}/x/passport-login/web/qrcode/poll${query({ qrcode_key: qrcodeKey, source: 'main-fe-header' })}`,
    );
    const code = Number(payload?.code);
    if (code !== 0) wrapCode(payload, { auth: 'AUTH_REQUIRED' });
    const data = payload.data ?? {};
    const inner = Number(data.code);
    if (inner === 86101) return { state: 'waiting', message: data.message ?? '二维码未扫描' };
    if (inner === 86090) return { state: 'scanned', message: data.message ?? '已扫描，等待确认' };
    if (inner === 86038) return { state: 'expired', message: data.message ?? '二维码已过期' };
    if (inner === 0) {
      // The cross-domain URL carries the same cookies; keep them as a fallback in case
      // a Set-Cookie header was dropped by a proxy.
      if (typeof data.url === 'string') {
        try {
          const target = new URL(data.url);
          for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']) {
            const value = target.searchParams.get(name);
            if (value) this.http.jar.set(name, value);
          }
        } catch {
          /* ignore malformed cross-domain URL */
        }
      }
      return { state: 'confirmed', message: data.message ?? '登录成功', url: data.url };
    }
    return { state: 'waiting', message: data.message ?? '等待扫码' };
  }
}
