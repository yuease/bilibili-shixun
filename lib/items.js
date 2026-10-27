import { hashId, normalizeWhitespace, parseDuration, stripHtml, toIso, truncate } from './util.js';

const DYNAMIC_TYPES = {
  DYNAMIC_TYPE_WORD: 'text_dynamic',
  DYNAMIC_TYPE_DRAW: 'image_dynamic',
  DYNAMIC_TYPE_ARTICLE: 'article',
  DYNAMIC_TYPE_MUSIC: 'audio',
  DYNAMIC_TYPE_LIVE_RCMD: 'live',
  DYNAMIC_TYPE_AV: 'video',
  DYNAMIC_TYPE_PGC: 'video',
  DYNAMIC_TYPE_OPUS: 'image_dynamic',
};

function httpsUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return `https://${value.slice('http://'.length)}`;
  return value.startsWith('https://') ? value : null;
}

export function originalImageUrl(url) {
  const normalized = httpsUrl(url);
  if (!normalized) return null;
  return normalized.split('@')[0];
}

const CONTENT_HOSTS = /(^|\.)(hdslb\.com|biliimg\.com)$/i;
const CONTENT_PATHS = /\/(bfs\/(new_dyn|album|archive|ugc|article))\//i;
const REJECTED_PATHS = /\/(face|emote|emoji|garb)\//i;

/** Accept only Bilibili content-image CDN URLs; reject avatars, emoji and unknown hosts. */
export function contentImageUrl(url) {
  const normalized = httpsUrl(url);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (!CONTENT_HOSTS.test(parsed.hostname)) return null;
    if (!CONTENT_PATHS.test(parsed.pathname)) return null;
    if (REJECTED_PATHS.test(parsed.pathname)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function videoIdentity(value) {
  const bvid = typeof value?.bvid === 'string' && /^BV[0-9A-Za-z]+$/.test(value.bvid) ? value.bvid : null;
  const aidRaw = value?.aid ?? value?.id;
  const aid = aidRaw !== undefined && aidRaw !== null && /^\d+$/.test(String(aidRaw)) ? String(aidRaw) : null;
  if (bvid) return { identity: bvid, bvid, aid };
  if (aid) return { identity: `av${aid}`, bvid: null, aid };
  return null;
}

export function normalizeVideo(value, context = {}) {
  const identity = videoIdentity(value);
  if (!identity) return null;
  const title = stripHtml(value.title);
  const body = normalizeWhitespace(stripHtml(value.description ?? value.desc ?? ''));
  const tags = typeof value.tag === 'string' ? value.tag.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
  const cover = httpsUrl(value.pic ?? value.cover);
  return {
    id: hashId(`bilibili:${identity.identity}`),
    bvid: identity.bvid,
    aid: identity.aid,
    source_kind: context.sourceKind ?? null,
    source_key: context.sourceKey ?? null,
    sources: context.sourceKind ? [`${context.sourceKind}:${context.sourceKey ?? ''}`] : [],
    content_type: 'video',
    title: truncate(title, 300) || '（无标题视频）',
    url: `https://www.bilibili.com/video/${identity.identity}`,
    author: truncate(stripHtml(value.author ?? value.owner?.name), 100) || '未知',
    author_uid: String(value.mid ?? value.owner?.mid ?? '') || null,
    published_at: toIso(value.pubdate ?? value.created),
    duration_seconds: parseDuration(value.duration ?? value.length) ?? null,
    body_text: body,
    excerpt: truncate(body, 400),
    tags,
    cover_url: cover,
    images: [],
    image_count: 0,
    images_status: 'known',
    attachments: [
      { type: 'video', title: truncate(title, 120), url: `https://www.bilibili.com/video/${identity.identity}`, details_status: 'complete' },
    ],
    attachments_status: 'known',
    dynamic_id: null,
    collected_at: null,
    first_seen_at: null,
  };
}

function dynamicImages(card, major) {
  const urls = [];
  const opus = major?.opus ?? {};
  if (Array.isArray(opus.pics)) urls.push(...opus.pics.map((pic) => pic?.url));
  const draw = major?.draw ?? {};
  if (Array.isArray(draw.items)) urls.push(...draw.items.map((item) => item?.src));
  return Array.from(new Set(urls.map(contentImageUrl).filter(Boolean))).slice(0, 12);
}

function dynamicAttachments(type, major, images, videoUrl) {
  const attachments = [];
  if (videoUrl) {
    attachments.push({ type: 'video', title: truncate(major?.archive?.title, 120), url: videoUrl, details_status: 'complete' });
  }
  if (major?.article && typeof major.article === 'object') {
    const article = major.article;
    attachments.push({
      type: 'article',
      title: truncate(stripHtml(article.title), 200),
      url: httpsUrl(article.jump_url ?? article.url),
      details_status: 'complete',
    });
  }
  if (major?.live_rcmd) {
    attachments.push({ type: 'live', title: '直播', details_status: 'unavailable' });
  }
  if (major?.music) {
    attachments.push({ type: 'audio', title: truncate(major.music.title, 200), details_status: 'complete' });
  }
  if (images.length) {
    attachments.push(
      ...images.map((url, index) => ({ type: 'image', index, url, details_status: 'complete' })),
    );
  }
  return attachments;
}

export function normalizeDynamic(card, context = {}) {
  const did = String(card?.id_str ?? '');
  if (!/^\d{1,30}$/.test(did)) return null;
  const modules = card.modules ?? {};
  const author = modules.module_author ?? {};
  const publishedAt = toIso(author.pub_ts);
  const forwarded = card.orig && typeof card.orig === 'object';
  const original = forwarded ? card.orig : card;
  const originalModules = original.modules ?? {};
  const originalAuthor = originalModules.module_author ?? {};
  const content = originalModules.module_dynamic ?? {};
  const major = content.major ?? {};
  const outerText = normalizeWhitespace(stripHtml(modules.module_dynamic?.desc?.text));
  const originalText = normalizeWhitespace(stripHtml(content.desc?.text));
  const kind = String(original.type ?? card.type ?? '');
  const archive = major.archive && typeof major.archive === 'object' ? major.archive : null;
  const images = dynamicImages(card, major);

  let item;
  if (archive) {
    item = normalizeVideo(
      {
        ...archive,
        pic: archive.cover,
        description: archive.desc ?? '',
        duration: archive.duration_text,
        author: originalAuthor.name,
        mid: originalAuthor.mid,
        pubdate: originalAuthor.pub_ts,
      },
      context,
    );
    if (!item) return null;
    item.author = truncate(stripHtml(originalAuthor.name), 100) || '未知';
    item.author_uid = String(originalAuthor.mid ?? '') || null;
    item.attachments = dynamicAttachments(kind, major, [], item.url);
    item.attachments_status = 'known';
  } else {
    const opus = major.opus ?? {};
    const body = originalText || normalizeWhitespace(stripHtml(opus.summary?.text));
    const contentType = DYNAMIC_TYPES[kind] ?? (images.length ? 'image_dynamic' : 'text_dynamic');
    const title = truncate(stripHtml(opus.title), 300) || truncate(body, 80) || '动态（文字缺失）';
    const attachments = dynamicAttachments(kind, major, images, null);
    item = {
      id: hashId(`bilibili:dynamic:${did}`),
      bvid: null,
      aid: null,
      source_kind: context.sourceKind ?? null,
      source_key: context.sourceKey ?? null,
      sources: context.sourceKind ? [`${context.sourceKind}:${context.sourceKey ?? ''}`] : [],
      content_type: contentType,
      title,
      url: `https://t.bilibili.com/${did}`,
      author: truncate(stripHtml(originalAuthor.name), 100) || '未知',
      author_uid: String(originalAuthor.mid ?? '') || null,
      published_at: publishedAt,
      duration_seconds: null,
      body_text: body,
      excerpt: truncate(body, 400),
      tags: [],
      cover_url: images[0] ?? null,
      images,
      image_count: images.length,
      images_status: 'known',
      attachments,
      attachments_status: attachments.length ? 'known' : 'unknown',
      dynamic_id: did,
      collected_at: null,
      first_seen_at: null,
    };
  }

  const contexts = [];
  if (outerText) {
    contexts.push({
      id: did,
      url: `https://t.bilibili.com/${did}`,
      author: truncate(stripHtml(author.name), 100),
      author_uid: String(author.mid ?? '') || null,
      text: truncate(outerText, 2000),
      published_at: publishedAt,
    });
  }
  if (forwarded && originalText) {
    const originalId = String(original.id_str ?? '');
    contexts.push({
      id: originalId,
      url: `https://t.bilibili.com/${originalId}`,
      author: truncate(stripHtml(originalAuthor.name), 100),
      author_uid: String(originalAuthor.mid ?? '') || null,
      text: truncate(originalText, 2000),
      published_at: toIso(originalAuthor.pub_ts),
    });
  }

  item.dynamic_id = did;
  item.dynamic_contexts = contexts;
  item.is_dynamic = true;
  item.repost_text = forwarded ? truncate(outerText, 2000) : '';
  item.activity_type = forwarded ? 'repost' : 'original';
  item.activity_url = `https://t.bilibili.com/${did}`;
  item.forwarded_by = forwarded ? truncate(stripHtml(author.name), 100) : null;
  item.original_published_at = forwarded ? toIso(originalAuthor.pub_ts) : null;
  item.original_author_uid = String(originalAuthor.mid ?? '') || null;
  item.published_at = publishedAt;
  if (forwarded && item.content_type !== 'video') {
    const originalId = String(original.id_str ?? '');
    if (/^\d{1,30}$/.test(originalId)) item.url = `https://t.bilibili.com/${originalId}`;
  }
  if (item.image_count !== images.length) {
    item.images = images;
    item.image_count = images.length;
    item.images_status = 'known';
  }
  if (!item.title && item.body_text) item.title = truncate(item.body_text, 80);
  return item;
}

export function dynamicBody(item) {
  const parts = [];
  if (item.repost_text) parts.push(`【转发自 ${item.forwarded_by ?? '原作者'}】\n${item.repost_text}`);
  if (item.body_text) parts.push(item.body_text);
  return parts.join('\n\n');
}
