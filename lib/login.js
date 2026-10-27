import { BiliError } from './errors.js';
import { qrPng } from './qr.js';
import { nowIso } from './util.js';

const QR_TTL_MS = 180_000;
const POLL_INTERVAL_MS = 2_500;

export class LoginService {
  constructor({ api, store, logger }) {
    this.api = api;
    this.store = store;
    this.logger = logger;
    this.pending = null;
    this.result = null;
    this.timer = null;
    this.polling = false;
    this.stopped = false;
  }

  restore() {
    const cookies = this.store.account.cookies ?? {};
    if (cookies && typeof cookies === 'object') this.api.http.jar.update(cookies);
  }

  status() {
    const account = this.store.accountState();
    return {
      ...account,
      pending: this.pending
        ? {
            state: this.pending.state,
            qr_expires_at: new Date(this.pending.expiresAt).toISOString(),
            scanned: this.pending.state === 'scanned',
          }
        : null,
      hint:
        account.status === 'valid'
          ? '已登录：UP主与关注来源可采集。'
          : account.status === 'expired'
            ? '登录已失效：公开关键词搜索仍可用；私有来源需重新扫码。'
            : '尚未登录：公开关键词搜索无需扫码。',
    };
  }

  async check() {
    const hadCookie = Boolean(this.store.account.cookies?.SESSDATA);
    try {
      const nav = await this.api.nav();
      if (nav.isLogin) {
        await this.store.setAccount({
          status: 'valid',
          uid: nav.uid,
          uname: nav.uname,
          checked_at: nowIso(),
          saved_at: this.store.account.saved_at ?? nowIso(),
          cookies: this.api.http.jar.toJSON(),
        });
        return { status: 'valid', uid: nav.uid, uname: nav.uname };
      }
      const status = hadCookie ? 'expired' : 'not_logged_in';
      await this.store.setAccount({ status, checked_at: nowIso() });
      return { status, uid: null, uname: null };
    } catch (error) {
      if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT' || error?.code === 'RATE_LIMITED') {
        return { status: this.store.account.status ?? 'unknown', unchecked: true, error: error.code };
      }
      throw error;
    }
  }

  async begin() {
    const reusable = this.pending && this.pending.expiresAt > Date.now() && ['waiting', 'scanned'].includes(this.pending.state);
    if (reusable) {
      return {
        url: this.pending.url,
        png: this.pending.png,
        expires_at: new Date(this.pending.expiresAt).toISOString(),
        reused: true,
      };
    }
    const { url, qrcodeKey } = await this.api.qrcodeGenerate();
    const png = qrPng(url, { scale: 8, margin: 4 });
    this.pending = {
      url,
      key: qrcodeKey,
      png,
      state: 'waiting',
      startedAt: Date.now(),
      expiresAt: Date.now() + QR_TTL_MS,
      polls: 0,
      errors: 0,
    };
    this.result = null;
    this.startPolling();
    return { url, png, expires_at: new Date(this.pending.expiresAt).toISOString(), reused: false };
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.timer = setInterval(() => {
      this.pollOnce().catch((error) => {
        if (this.logger?.warn) this.logger.warn(`[bilibili-shixun] qr poll failed: ${error?.code ?? error?.message}`);
      });
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stopPolling() {
    this.polling = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollOnce() {
    const pending = this.pending;
    if (!pending || pending.state === 'confirmed' || pending.state === 'expired') {
      this.stopPolling();
      return this.pending?.state ?? 'idle';
    }
    if (Date.now() > pending.expiresAt) {
      pending.state = 'expired';
      this.result = { status: 'expired', at: nowIso() };
      this.stopPolling();
      return 'expired';
    }
    pending.polls += 1;
    try {
      const poll = await this.api.qrcodePoll(pending.key);
      if (poll.state === 'scanned') {
        pending.state = 'scanned';
        return 'scanned';
      }
      if (poll.state === 'expired') {
        pending.state = 'expired';
        this.result = { status: 'expired', at: nowIso(), message: poll.message };
        this.stopPolling();
        return 'expired';
      }
      if (poll.state === 'confirmed') {
        const nav = await this.api.nav();
        if (!nav.isLogin) throw new BiliError('AUTH_REQUIRED', '扫码已确认但账号状态无效');
        pending.state = 'confirmed';
        await this.store.setAccount({
          status: 'valid',
          uid: nav.uid,
          uname: nav.uname,
          cookies: this.api.http.jar.toJSON(),
          saved_at: nowIso(),
          checked_at: nowIso(),
          login_message: null,
        });
        this.result = { status: 'valid', uid: nav.uid, uname: nav.uname, at: nowIso() };
        this.stopPolling();
        return 'confirmed';
      }
      return 'waiting';
    } catch (error) {
      pending.errors += 1;
      const fatal = error?.code === 'AUTH_REQUIRED' || error?.code === 'AUTH_EXPIRED';
      if (fatal || pending.errors >= 6) {
        pending.state = fatal ? 'expired' : 'error';
        this.result = { status: 'failed', at: nowIso(), error: error?.code ?? 'UNKNOWN' };
        this.stopPolling();
        return pending.state;
      }
      return 'waiting';
    }
  }

  async logout() {
    this.stopPolling();
    this.pending = null;
    this.api.http.jar.set('SESSDATA', '');
    this.api.http.jar.set('bili_jct', '');
    this.api.http.jar.set('DedeUserID', '');
    this.api.http.jar.set('DedeUserID__ckMd5', '');
    await this.store.setAccount({
      status: 'not_logged_in',
      uid: null,
      uname: null,
      cookies: {},
      saved_at: null,
      checked_at: nowIso(),
    });
    if (this.store.settings.followingEnabled) {
      this.store.settings.followingEnabled = false;
      this.store.bumpVersion();
      await this.store.save();
    }
    return { status: 'not_logged_in' };
  }

  dispose() {
    this.stopped = true;
    this.stopPolling();
    this.pending = null;
  }
}
