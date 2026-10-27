/**
 * B站拾讯 client half: one settings page (settings.section) that drives the
 * Host API registered by lib/webui.js. Plain React from the browser module
 * table, no build step, no extra runtime dependency.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bilibili-shixun',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'bilibili-shixun';
    const API = '/bilibili-shixun/api';

    const MESSAGES = {
      zh: {
        nav: 'B站拾讯',
        subtitle: '直连 B 站 · 关键词 / UP 主 / 关注订阅 · 本地内容库',
        account: '账号',
        loggedIn: '已登录',
        notLoggedIn: '未登录',
        expired: '登录已失效',
        uid: 'UID',
        login: '扫码登录',
        relogin: '重新扫码',
        logout: '退出登录',
        check: '检查状态',
        qrHint: '用 B 站手机客户端扫码，并在手机上确认登录。二维码只保存在本机。',
        qrExpires: '剩余',
        qrExpired: '二维码已过期，请重新生成。',
        qrRefresh: '刷新二维码',
        accountHint: '公开关键词搜索无需登录；UP 主动态与「我的关注」需要登录。',
        sources: '订阅来源',
        keywords: '长期关键词',
        keywordPlaceholder: '输入关键词后回车',
        add: '添加',
        keywordsHint: '最多 5 个；关键词来源按最新发布读取一页 30 条。',
        keywordToggle: '启用关键词采集',
        ups: 'UP 主',
        upUidPlaceholder: 'UP 主 UID（数字）',
        upNamePlaceholder: '显示名称（可选）',
        upsHint: '匿名即可采集 UP 投稿；勾选「同时看动态」需要登录。',
        upDynamics: '动态',
        following: '我的关注',
        followingHint: '采集关注视频与综合动态，需要已扫码登录。',
        save: '保存设置',
        saving: '保存中…',
        saved: '设置已保存。',
        cancel: '撤销修改',
        collect: '采集',
        pages: '每个动态来源最多批数',
        candidates: '每来源候选上限',
        schedule: '定时采集',
        scheduleEnable: '按时自动采集',
        scheduleEvery: '间隔',
        scheduleNext: '下次采集',
        scheduleIdle: '未启用定时采集',
        scheduleNote: '仅在 DSH 运行期间执行；错过的时间点会在下次启动后补跑一次。',
        minutes: '分钟',
        refresh: '立即刷新来源',
        refreshing: '采集中…',
        refreshHint: '采集在后台执行；任务结束不代表已取完所有更新。',
        jobIdle: '尚未采集',
        jobRunning: '采集中',
        jobCompleted: '已完成',
        jobFailed: '失败',
        completeness: '数据完整性',
        requirements: '未启用任何来源：先添加关键词或 UP 主，或开启「我的关注」。',
        sourcesState: '来源状态',
        sourceName: '来源',
        sourceStatus: '状态',
        sourceLastSuccess: '最近成功',
        sourceRetained: '保留',
        sourceScan: '扫描',
        never: '未采集',
        items: '最近内容',
        itemsEmpty: '本地还没有内容，先刷新来源。',
        itemsCount: '条',
        openOriginal: '打开原文',
        accountLoginFirst: '请先登录 B 站。',
        settingsConflict: '设置已在别处更新，已重新载入，请再改一次。',
        errorPrefix: '操作失败：',
        dataDir: '数据目录',
        footerNote: '结果只来自已采集内容；来源失败与覆盖未知会分别标注。凭据仅保存在本机 account.json。',
        deleteChip: '移除',
        interests: '兴趣说明（用于简报素材）',
        interestsPlaceholder: '例如：天文、望远镜、深空摄影；不喜欢短视频。',
        advanced: '兴趣与简报',
        clear: '清空',
      },
      en: {
        nav: 'Bilibili Briefing',
        subtitle: 'Bilibili direct · keyword / creator / following subscriptions · local library',
        account: 'Account',
        loggedIn: 'Signed in',
        notLoggedIn: 'Not signed in',
        expired: 'Session expired',
        uid: 'UID',
        login: 'Scan to sign in',
        relogin: 'Scan again',
        logout: 'Sign out',
        check: 'Check status',
        qrHint: 'Scan with the Bilibili mobile app and confirm on the phone. The QR stays on this machine.',
        qrExpires: 'expires in',
        qrExpired: 'This QR expired. Generate a new one.',
        qrRefresh: 'New QR',
        accountHint: 'Anonymous keyword search needs no login; creator dynamics and following need one.',
        sources: 'Subscriptions',
        keywords: 'Keywords',
        keywordPlaceholder: 'Type a keyword and press Enter',
        add: 'Add',
        keywordsHint: 'Up to 5 keywords; each reads one page of 30 newest videos.',
        keywordToggle: 'Collect keyword sources',
        ups: 'Creators',
        upUidPlaceholder: 'Creator UID (digits)',
        upNamePlaceholder: 'Display name (optional)',
        upsHint: 'Creator uploads work anonymously; dynamics need a login.',
        upDynamics: 'dynamics',
        following: 'My following',
        followingHint: 'Collects following videos and dynamics; requires a signed-in account.',
        save: 'Save settings',
        saving: 'Saving…',
        saved: 'Settings saved.',
        cancel: 'Discard changes',
        collect: 'Collection',
        pages: 'Max batches per dynamic source',
        candidates: 'Max candidates per source',
        schedule: 'Scheduled collection',
        scheduleEnable: 'Collect on a timer',
        scheduleEvery: 'Every',
        scheduleNext: 'Next run',
        scheduleIdle: 'Schedule is off',
        scheduleNote: 'Runs only while DSH is running; a missed slot is caught up on the next start.',
        minutes: 'min',
        refresh: 'Refresh sources now',
        refreshing: 'Collecting…',
        refreshHint: 'Runs in the background; a finished job does not mean everything was fetched.',
        jobIdle: 'Never collected',
        jobRunning: 'Running',
        jobCompleted: 'Completed',
        jobFailed: 'Failed',
        completeness: 'Data completeness',
        requirements: 'No enabled sources yet: add a keyword, a creator, or enable following.',
        sourcesState: 'Source status',
        sourceName: 'Source',
        sourceStatus: 'Status',
        sourceLastSuccess: 'Last success',
        sourceRetained: 'Retained',
        sourceScan: 'Scan',
        never: 'Never',
        items: 'Recent items',
        itemsEmpty: 'The library is empty. Refresh sources first.',
        itemsCount: 'items',
        openOriginal: 'Open original',
        accountLoginFirst: 'Sign in to Bilibili first.',
        settingsConflict: 'Settings changed elsewhere; reloaded. Please try again.',
        errorPrefix: 'Failed: ',
        dataDir: 'Data directory',
        footerNote: 'Results come only from retained data; source failures and unknown coverage are labeled separately. Credentials stay in the local account.json.',
        deleteChip: 'Remove',
        interests: 'Interests (briefing material)',
        interestsPlaceholder: 'e.g. astronomy, telescopes, deep-sky photography; no short videos.',
        advanced: 'Interests & briefing',
        clear: 'Clear',
      },
    };

    let tr = (key) => MESSAGES.zh[key] || key;

    async function request(path, options) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
        headers: {
          'content-type': 'application/json',
          ...(options && options.headers ? options.headers : {}),
        },
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || (data && data.ok === false)) {
        const error = new Error((data && data.error && data.error.message) || `HTTP ${response.status}`);
        error.code = data && data.error ? data.error.code : 'HTTP';
        throw error;
      }
      return data;
    }

    const fmtTime = (iso) => {
      if (!iso) return '—';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString();
    };

    const numberValue = (value, fallback) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    function Badge(props) {
      const style = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' };
      const dot = {
        width: 8,
        height: 8,
        borderRadius: 999,
        background:
          props.tone === 'ok'
            ? 'var(--dsw-alias-state-success-primary)'
            : props.tone === 'warn'
              ? 'var(--dsw-alias-state-warn-primary)'
              : props.tone === 'bad'
                ? 'var(--dsw-alias-state-error-primary)'
                : 'var(--dsw-alias-state-idle-primary)',
      };
      return h('span', { style }, h('span', { style: dot }), props.children);
    }

    function Card(props) {
      return h(
        'section',
        { className: 'bsx-card' },
        h(
          'div',
          { className: 'bsx-card-head' },
          h('h3', { className: 'bsx-h3' }, props.title),
          props.extra || null,
        ),
        props.children,
      );
    }

    function Chip(props) {
      return h(
        'span',
        { className: 'bsx-chip' },
        props.children,
        props.onRemove
          ? h(
              'button',
              {
                type: 'button',
                className: 'bsx-chip-x',
                title: tr('deleteChip'),
                onClick: props.onRemove,
              },
              '×',
            )
          : null,
      );
    }

    function statusTone(availability) {
      if (availability === 'ready') return 'ok';
      if (availability === 'partial') return 'warn';
      if (availability === 'error') return 'bad';
      return 'idle';
    }

    function Page() {
      const [snap, setSnap] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [msg, setMsg] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [keyword, setKeyword] = React.useState('');
      const [upUid, setUpUid] = React.useState('');
      const [upName, setUpName] = React.useState('');
      const [qrNonce, setQrNonce] = React.useState(0);
      const [now, setNow] = React.useState(Date.now());
      const dirtyRef = React.useRef(false);

      const applyState = React.useCallback((data) => {
        setSnap(data);
        if (dirtyRef.current) return;
        setDraft({
          keywords: data.settings.keywords.slice(),
          ups: data.settings.ups.slice(),
          following_enabled: data.settings.following_enabled,
          keyword_search_enabled: data.settings.keyword_search_enabled,
          interests: data.settings.interests || '',
          collect: {
            max_pages_per_source: data.settings.collect.maxPagesPerSource,
            max_candidates_per_source: data.settings.collect.maxCandidatesPerSource,
            enabled: Boolean(data.settings.collect.enabled),
            interval_minutes: data.settings.collect.intervalMinutes,
          },
        });
      }, []);

      const load = React.useCallback(
        async (silent) => {
          try {
            const data = await request(`${API}/state`);
            applyState(data);
            if (!silent) setMsg(null);
          } catch (error) {
            if (!silent) setMsg({ tone: 'bad', text: error.message });
          }
        },
        [applyState],
      );

      React.useEffect(() => {
        load(false);
      }, [load]);

      const rawPending = snap && snap.account ? snap.account.pending : null;
      const pending = rawPending && rawPending.state !== 'confirmed' ? rawPending : null;
      const running = snap && snap.job ? snap.job.status === 'running' : false;
      React.useEffect(() => {
        if (!pending && !running) return undefined;
        const timer = setInterval(() => load(true), 2500);
        return () => clearInterval(timer);
      }, [pending, running, load]);

      React.useEffect(() => {
        if (!pending) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, [pending]);

      const edit = (mutate) => {
        dirtyRef.current = true;
        setDraft((current) => {
          if (!current) return current;
          const next = {
            ...current,
            keywords: current.keywords.slice(),
            ups: current.ups.map((up) => ({ ...up })),
            collect: { ...current.collect },
          };
          mutate(next);
          return next;
        });
        setMsg(null);
      };

      const save = async () => {
        if (!snap || !draft) return;
        setBusy('save');
        setMsg(null);
        try {
          const serverKeywords = snap.settings.keywords;
          const serverUps = snap.settings.ups.map((up) => up.uid);
          const data = await request(`${API}/settings`, {
            method: 'POST',
            body: JSON.stringify({
              expected_version: snap.version,
              add_keywords: draft.keywords.filter((word) => !serverKeywords.includes(word)),
              remove_keywords: serverKeywords.filter((word) => !draft.keywords.includes(word)),
              add_ups: draft.ups.filter((up) => !serverUps.includes(up.uid)),
              remove_ups: serverUps.filter((uid) => !draft.ups.some((up) => up.uid === uid)),
              following_enabled: draft.following_enabled,
              keyword_search_enabled: draft.keyword_search_enabled,
              interests: draft.interests,
              collect: draft.collect,
            }),
          });
          dirtyRef.current = false;
          applyState(data.state);
          setMsg({ tone: 'ok', text: data.changed ? tr('saved') : tr('saved') });
        } catch (error) {
          if (error.code === 'SETTINGS_CONFLICT') {
            dirtyRef.current = false;
            await load(true);
            setMsg({ tone: 'warn', text: tr('settingsConflict') });
          } else {
            setMsg({ tone: 'bad', text: tr('errorPrefix') + error.message });
          }
        } finally {
          setBusy('');
        }
      };

      const refresh = async () => {
        setBusy('refresh');
        setMsg(null);
        try {
          const data = await request(`${API}/refresh`, { method: 'POST', body: '{}' });
          applyState(data.state);
          setMsg({ tone: 'ok', text: tr('refreshHint') });
        } catch (error) {
          setMsg({ tone: 'bad', text: tr('errorPrefix') + error.message });
        } finally {
          setBusy('');
        }
      };

      const login = async () => {
        setBusy('login');
        setMsg(null);
        try {
          const data = await request(`${API}/login`, { method: 'POST', body: '{}' });
          applyState(data.state);
          setQrNonce((value) => value + 1);
        } catch (error) {
          setMsg({ tone: 'bad', text: tr('errorPrefix') + error.message });
        } finally {
          setBusy('');
        }
      };

      const logout = async () => {
        setBusy('logout');
        try {
          const data = await request(`${API}/logout`, { method: 'POST', body: '{}' });
          applyState(data.state);
        } catch (error) {
          setMsg({ tone: 'bad', text: tr('errorPrefix') + error.message });
        } finally {
          setBusy('');
        }
      };

      const check = async () => {
        setBusy('check');
        try {
          const data = await request(`${API}/account/check`, { method: 'POST', body: '{}' });
          applyState(data.state);
        } catch (error) {
          setMsg({ tone: 'bad', text: tr('errorPrefix') + error.message });
        } finally {
          setBusy('');
        }
      };

      if (!snap || !draft) {
        return h('div', { className: 'bsx-root' }, h('p', { className: 'bsx-muted' }, tr('subtitle')));
      }

      const account = snap.account;
      const signedIn = account.status === 'valid';
      const statusKey = account.status === 'valid' ? 'loggedIn' : account.status === 'expired' ? 'expired' : 'notLoggedIn';
      const accountTone = signedIn ? 'ok' : account.status === 'expired' ? 'warn' : 'idle';
      const remaining = pending ? Math.max(0, Math.floor((Date.parse(pending.qr_expires_at) - now) / 1000)) : 0;
      const job = snap.job || { status: 'idle' };
      const jobKey = job.status === 'running' ? 'jobRunning' : job.status === 'completed' ? 'jobCompleted' : job.status === 'failed' ? 'jobFailed' : 'jobIdle';
      const dirty =
        draft.keywords.join('\u0000') !== snap.settings.keywords.join('\u0000') ||
        draft.ups.map((up) => up.uid).join(',') !== snap.settings.ups.map((up) => up.uid).join(',') ||
        draft.following_enabled !== snap.settings.following_enabled ||
        draft.keyword_search_enabled !== snap.settings.keyword_search_enabled ||
        draft.interests !== (snap.settings.interests || '') ||
        draft.collect.max_pages_per_source !== snap.settings.collect.maxPagesPerSource ||
        draft.collect.max_candidates_per_source !== snap.settings.collect.maxCandidatesPerSource ||
        draft.collect.enabled !== Boolean(snap.settings.collect.enabled) ||
        draft.collect.interval_minutes !== snap.settings.collect.intervalMinutes;

      const addKeyword = () => {
        const word = keyword.trim();
        if (!word) return;
        if (draft.keywords.includes(word)) {
          setKeyword('');
          return;
        }
        if (draft.keywords.length >= 5) {
          setMsg({ tone: 'warn', text: tr('keywordsHint') });
          return;
        }
        edit((next) => next.keywords.push(word));
        setKeyword('');
      };

      const addUp = () => {
        const uid = upUid.trim();
        if (!/^\d{1,30}$/.test(uid)) {
          setMsg({ tone: 'warn', text: tr('upUidPlaceholder') });
          return;
        }
        if (draft.ups.some((up) => up.uid === uid)) {
          setUpUid('');
          return;
        }
        edit((next) => next.ups.push({ uid, name: upName.trim(), include_dynamics: false }));
        setUpUid('');
        setUpName('');
      };

      return h(
        'div',
        { className: 'bsx-root' },
        h('style', null, CSS),
        h(
          'header',
          { className: 'bsx-header' },
          h('h2', { className: 'bsx-title' }, tr('nav')),
          h('p', { className: 'bsx-muted' }, tr('subtitle')),
        ),
        msg
          ? h(
              'div',
              {
                className:
                  'bsx-msg ' +
                  (msg.tone === 'bad' ? 'bsx-msg-bad' : msg.tone === 'warn' ? 'bsx-msg-warn' : 'bsx-msg-ok'),
              },
              msg.text,
            )
          : null,

        h(
          Card,
          {
            title: tr('account'),
            extra: h(Badge, { tone: accountTone }, tr(statusKey)),
          },
          h(
            'div',
            { className: 'bsx-line' },
            signedIn
              ? h(
                  'span',
                  null,
                  tr('uid') +
                    ' ' +
                    (account.uid || '—') +
                    (account.uname ? ' · ' + account.uname : '') +
                    (account.checked_at ? ' · ' + fmtTime(account.checked_at) : ''),
                )
              : h('span', { className: 'bsx-muted' }, tr('accountHint')),
          ),
          h(
            'div',
            { className: 'bsx-row' },
            h(
              'button',
              { type: 'button', className: 'bsx-btn bsx-primary', onClick: login, disabled: busy === 'login' },
              signedIn ? tr('relogin') : tr('login'),
            ),
            h('button', { type: 'button', className: 'bsx-btn', onClick: check, disabled: busy === 'check' }, tr('check')),
            h(
              'button',
              { type: 'button', className: 'bsx-btn', onClick: logout, disabled: !signedIn || busy === 'logout' },
              tr('logout'),
            ),
          ),
          pending
            ? h(
                'div',
                { className: 'bsx-qr' },
                h('img', {
                  className: 'bsx-qr-img',
                  alt: tr('qrHint'),
                  src: `${API}/login/qr?v=${qrNonce}`,
                }),
                h(
                  'div',
                  { className: 'bsx-qr-side' },
                  h('p', { className: 'bsx-muted' }, tr('qrHint')),
                  h(
                    'p',
                    { className: 'bsx-muted' },
                    remaining > 0 ? `${tr('qrExpires')} ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : tr('qrExpired'),
                  ),
                  h('button', { type: 'button', className: 'bsx-btn', onClick: login, disabled: busy === 'login' }, tr('qrRefresh')),
                ),
              )
            : null,
        ),

        h(
          Card,
          {
            title: tr('sources'),
            extra: h('span', { className: 'bsx-muted' }, `${draft.keywords.length}/5`),
          },
          h('h4', { className: 'bsx-h4' }, tr('keywords')),
          h(
            'div',
            { className: 'bsx-chips' },
            draft.keywords.length
              ? draft.keywords.map((word) =>
                  h(
                    Chip,
                    {
                      key: word,
                      onRemove: () => edit((next) => next.keywords.splice(next.keywords.indexOf(word), 1)),
                    },
                    word,
                  ),
                )
              : h('span', { className: 'bsx-muted' }, tr('keywordsHint')),
          ),
          h(
            'div',
            { className: 'bsx-row' },
            h('input', {
              className: 'bsx-input',
              value: keyword,
              placeholder: tr('keywordPlaceholder'),
              maxLength: 100,
              onChange: (event) => setKeyword(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addKeyword();
              },
            }),
            h('button', { type: 'button', className: 'bsx-btn', onClick: addKeyword }, tr('add')),
          ),
          h(
            'label',
            { className: 'bsx-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.keyword_search_enabled,
              onChange: (event) => edit((next) => (next.keyword_search_enabled = event.target.checked)),
            }),
            tr('keywordToggle'),
          ),

          h('h4', { className: 'bsx-h4' }, tr('ups')),
          h(
            'div',
            { className: 'bsx-chips' },
            draft.ups.length
              ? draft.ups.map((up) =>
                  h(
                    Chip,
                    {
                      key: up.uid,
                      onRemove: () => edit((next) => (next.ups = next.ups.filter((row) => row.uid !== up.uid))),
                    },
                    (up.name ? up.name + ' · ' : '') + up.uid,
                  ),
                )
              : h('span', { className: 'bsx-muted' }, tr('upsHint')),
          ),
          h(
            'div',
            { className: 'bsx-row' },
            h('input', {
              className: 'bsx-input bsx-input-uid',
              value: upUid,
              placeholder: tr('upUidPlaceholder'),
              inputMode: 'numeric',
              onChange: (event) => setUpUid(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addUp();
              },
            }),
            h('input', {
              className: 'bsx-input',
              value: upName,
              placeholder: tr('upNamePlaceholder'),
              maxLength: 100,
              onChange: (event) => setUpName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') addUp();
              },
            }),
            h('button', { type: 'button', className: 'bsx-btn', onClick: addUp }, tr('add')),
          ),

          h(
            'label',
            { className: 'bsx-check' },
            h('input', {
              type: 'checkbox',
              checked: draft.following_enabled,
              onChange: (event) => edit((next) => (next.following_enabled = event.target.checked)),
            }),
            tr('following'),
            h('span', { className: 'bsx-muted bsx-inline-hint' }, tr('followingHint')),
          ),

          h(
            'details',
            { className: 'bsx-details' },
            h('summary', null, tr('advanced')),
            h('textarea', {
              className: 'bsx-input bsx-textarea',
              rows: 3,
              maxLength: 10000,
              placeholder: tr('interestsPlaceholder'),
              value: draft.interests,
              onChange: (event) => edit((next) => (next.interests = event.target.value)),
            }),
            h(
              'div',
              { className: 'bsx-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'bsx-btn',
                  onClick: () => edit((next) => (next.interests = '')),
                },
                tr('clear'),
              ),
            ),
          ),

          h(
            'div',
            { className: 'bsx-row bsx-row-end' },
            dirty
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'bsx-btn',
                    onClick: () => {
                      dirtyRef.current = false;
                      load(false);
                    },
                  },
                  tr('cancel'),
                )
              : null,
            h(
              'button',
              { type: 'button', className: 'bsx-btn bsx-primary', onClick: save, disabled: !dirty || busy === 'save' },
              busy === 'save' ? tr('saving') : tr('save'),
            ),
          ),
        ),

        h(
          Card,
          {
            title: tr('collect'),
            extra: h(Badge, { tone: job.status === 'running' ? 'warn' : job.status === 'failed' ? 'bad' : 'idle' }, tr(jobKey)),
          },
          h(
            'div',
            { className: 'bsx-fields' },
            h(
              'label',
              { className: 'bsx-field' },
              h('span', null, tr('pages')),
              h('input', {
                className: 'bsx-input bsx-input-num',
                type: 'number',
                min: 1,
                max: 5,
                value: draft.collect.max_pages_per_source,
                onChange: (event) =>
                  edit(
                    (next) =>
                      (next.collect.max_pages_per_source = Math.min(5, Math.max(1, numberValue(event.target.value, 1)))),
                  ),
              }),
            ),
            h(
              'label',
              { className: 'bsx-field' },
              h('span', null, tr('candidates')),
              h('input', {
                className: 'bsx-input bsx-input-num',
                type: 'number',
                min: 5,
                max: 200,
                value: draft.collect.max_candidates_per_source,
                onChange: (event) =>
                  edit(
                    (next) =>
                      (next.collect.max_candidates_per_source = Math.min(
                        200,
                        Math.max(5, numberValue(event.target.value, 60)),
                      )),
                  ),
              }),
            ),
          ),
          h(
            'div',
            { className: 'bsx-row' },
            h(
              'button',
              { type: 'button', className: 'bsx-btn', onClick: refresh, disabled: busy === 'refresh' || running },
              busy === 'refresh' || running ? tr('refreshing') : tr('refresh'),
            ),
            h(
              'span',
              { className: 'bsx-muted' },
              job.id ? `${tr(jobKey)} · ${fmtTime(job.finished_at || job.started_at)} · ${tr('completeness')}: ${job.data_completeness}` : tr('jobIdle'),
            ),
          ),
          h(
            'div',
            { className: 'bsx-schedule' },
            h('h4', { className: 'bsx-h4' }, tr('schedule')),
            h(
              'label',
              { className: 'bsx-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(draft.collect.enabled),
                onChange: (event) => edit((next) => (next.collect.enabled = event.target.checked)),
              }),
              tr('scheduleEnable'),
            ),
            h(
              'div',
              { className: 'bsx-row' },
              h('span', { className: 'bsx-muted' }, tr('scheduleEvery')),
              h(
                'select',
                {
                  className: 'bsx-input bsx-input-num',
                  value: draft.collect.interval_minutes,
                  onChange: (event) =>
                    edit((next) => (next.collect.interval_minutes = numberValue(event.target.value, 60))),
                },
                [30, 60, 120, 360].map((value) =>
                  h('option', { key: value, value }, value + ' ' + tr('minutes')),
                ),
              ),
              h(
                'span',
                { className: 'bsx-muted' },
                snap.schedule && snap.schedule.enabled && snap.schedule.next_run_at
                  ? tr('scheduleNext') + ' · ' + fmtTime(snap.schedule.next_run_at)
                  : tr('scheduleIdle'),
              ),
            ),
            h('p', { className: 'bsx-muted' }, tr('scheduleNote')),
          ),
          h('p', { className: 'bsx-muted' }, tr('refreshHint')),
          job.warnings && job.warnings.length
            ? h(
                'ul',
                { className: 'bsx-warnings' },
                job.warnings.slice(0, 6).map((warning, index) => h('li', { key: index }, warning)),
              )
            : null,
          h('h4', { className: 'bsx-h4' }, tr('sourcesState')),
          snap.sources.length
            ? h(
                'table',
                { className: 'bsx-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', null, tr('sourceName')),
                    h('th', null, tr('sourceStatus')),
                    h('th', null, tr('sourceLastSuccess')),
                    h('th', null, tr('sourceRetained')),
                    h('th', null, tr('sourceScan')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  snap.sources.map((source) =>
                    h(
                      'tr',
                      { key: source.kind + ':' + source.key },
                      h('td', null, source.label),
                      h('td', null, h(Badge, { tone: statusTone(source.availability) }, source.availability)),
                      h('td', null, fmtTime(source.last_success_at)),
                      h('td', null, String(source.retained_count)),
                      h(
                        'td',
                        null,
                        source.scan
                          ? `${source.scan.batches || 0} / ${source.scan.stop_reason || '—'}`
                          : tr('never'),
                      ),
                    ),
                  ),
                ),
              )
            : h('p', { className: 'bsx-muted' }, tr('requirements')),
        ),

        h(
          Card,
          {
            title: tr('items'),
            extra: h('span', { className: 'bsx-muted' }, `${snap.counts.retained_items} ${tr('itemsCount')}`),
          },
          snap.items.length
            ? h(
                'ul',
                { className: 'bsx-items' },
                snap.items.map((item) =>
                  h(
                    'li',
                    { key: item.item_id, className: 'bsx-item' },
                    h(
                      'a',
                      { className: 'bsx-item-title', href: item.url, target: '_blank', rel: 'noreferrer' },
                      item.title,
                    ),
                    h(
                      'div',
                      { className: 'bsx-muted bsx-item-meta' },
                      [
                        item.author,
                        item.published,
                        item.content_type,
                        item.duration_seconds ? item.duration_seconds + 's' : null,
                        (item.sources || []).map((source) => source.label).join(' / '),
                        item.image_count ? item.image_count + ' 图' : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                ),
              )
            : h('p', { className: 'bsx-muted' }, tr('itemsEmpty')),
        ),

        h(
          'footer',
          { className: 'bsx-footer' },
          h('p', { className: 'bsx-muted' }, `${tr('dataDir')}: ${snap.data_dir}`),
          h('p', { className: 'bsx-muted' }, tr('footerNote')),
        ),
      );
    }

    const CSS = `
.bsx-root { display:flex; flex-direction:column; gap:14px; padding: 4px 2px 24px; color: var(--dsw-alias-label-primary); font-size: 14px; }
.bsx-header { display:flex; flex-direction:column; gap:4px; }
.bsx-title { margin:0; font-size:18px; font-weight:600; }
.bsx-muted { color: var(--dsw-alias-label-secondary); font-size:12.5px; margin:0; line-height:1.55; }
.bsx-h3 { margin:0; font-size:14px; font-weight:600; }
.bsx-h4 { margin:14px 0 8px; font-size:13px; font-weight:600; color: var(--dsw-alias-label-primary); }
.bsx-card { border:1px solid var(--dsw-alias-border-l1); border-radius:12px; padding:14px 16px; background: var(--dsw-alias-bg-layer-1); display:flex; flex-direction:column; }
.bsx-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.bsx-line { margin-top:8px; }
.bsx-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px; }
.bsx-row-end { justify-content:flex-end; }
.bsx-btn { border:1px solid var(--dsw-alias-border-l2); background:transparent; color:inherit; border-radius:8px; padding:6px 12px; font-size:13px; cursor:pointer; font-family:inherit; }
.bsx-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.bsx-btn:disabled { opacity:.5; cursor:not-allowed; }
.bsx-primary { background: var(--dsw-alias-brand-primary); border-color:transparent; color:#fff; }
.bsx-input { background: var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l1); color:inherit; border-radius:8px; padding:6px 10px; font:inherit; font-size:13px; min-width: 180px; }
.bsx-input:focus { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-1px; }
.bsx-input-uid { min-width:150px; }
.bsx-input-num { min-width:90px; width:90px; }
.bsx-textarea { width:100%; margin-top:8px; resize:vertical; }
.bsx-check { display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px; }
.bsx-inline-hint { margin-left:8px; }
.bsx-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.bsx-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:3px 10px; font-size:12.5px; background: var(--dsw-alias-bg-layer-2); }
.bsx-chip-x { border:0; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; font-size:14px; line-height:1; padding:0; }
.bsx-chip-x:hover { color: var(--dsw-alias-state-error-primary); }
.bsx-msg { border-radius:10px; padding:9px 12px; font-size:13px; border:1px solid var(--dsw-alias-border-l1); }
.bsx-msg-ok { color: var(--dsw-alias-state-success-primary); }
.bsx-msg-warn { color: var(--dsw-alias-state-warn-primary); }
.bsx-msg-bad { color: var(--dsw-alias-state-error-primary); }
.bsx-fields { display:flex; gap:16px; flex-wrap:wrap; margin-top:10px; }
.bsx-field { display:flex; flex-direction:column; gap:6px; font-size:12.5px; color: var(--dsw-alias-label-secondary); }
.bsx-table { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:6px; }
.bsx-table th, .bsx-table td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--dsw-alias-border-l1); vertical-align:top; }
.bsx-table th { color: var(--dsw-alias-label-secondary); font-weight:500; }
.bsx-warnings { margin:8px 0 0; padding-left:18px; color: var(--dsw-alias-state-warn-primary); font-size:12.5px; }
.bsx-items { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; }
.bsx-item { padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.bsx-item:last-child { border-bottom:0; }
.bsx-item-title { color: inherit; font-size:13.5px; text-decoration:none; }
.bsx-item-title:hover { color: var(--dsw-alias-brand-primary); text-decoration:underline; }
.bsx-item-meta { margin-top:3px; }
.bsx-qr { display:flex; gap:16px; align-items:center; margin-top:14px; padding:12px; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; }
.bsx-qr-img { width:180px; height:180px; border-radius:8px; background:#fff; padding:6px; }
.bsx-qr-side { display:flex; flex-direction:column; gap:8px; }
.bsx-schedule { margin-top:14px; padding-top:10px; border-top:1px dashed var(--dsw-alias-border-l1); }
.bsx-details { margin-top:12px; }
.bsx-details summary { cursor:pointer; font-size:13px; color: var(--dsw-alias-label-secondary); }
.bsx-footer { display:flex; flex-direction:column; gap:4px; margin-top:4px; word-break:break-all; }
`;

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'bilibili-shixun: dictionaries');
        const t = ctx.locale.bind(NS);
        tr = (key) => {
          const value = t(key);
          return value === key ? MESSAGES.zh[key] || key : value;
        };
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'bilibili-shixun',
              order: 25,
              label: () => tr('nav'),
              locale: NS,
              inject: () => ({ t }),
            },
            Page,
          ),
        );
      },
    };
  },
});
