import { formatDuration, formatInZone, truncate } from './util.js';

const KIND_LABELS = {
  keyword_search: '关键词',
  up_uploads: 'UP投稿',
  up_dynamics: 'UP动态',
  following_videos: '关注视频',
  following_dynamics: '关注动态',
  temporary_keyword: '临时搜索',
};

export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

export function sourceList(item) {
  return (item.sources ?? []).map((tag) => {
    const [kind, ...rest] = String(tag).split(':');
    const key = rest.join(':');
    return { kind, key, label: `${kindLabel(kind)} · ${key}` };
  });
}

function attachmentTypes(item) {
  return Array.from(new Set((item.attachments ?? []).map((attachment) => attachment.type).filter(Boolean)));
}

export function itemView(item, timezone = 'Asia/Shanghai') {
  const snippet = truncate(item.excerpt || item.body_text || '', 240);
  const view = {
    item_id: item.id,
    title: item.title,
    author: item.author,
    published: formatInZone(item.published_at, timezone),
    published_at: item.published_at,
    url: item.url,
    content_type: item.content_type,
    duration_seconds: item.duration_seconds ?? null,
    image_count: item.image_count ?? 0,
    images_status: item.images_status ?? 'unknown',
    attachments_status: item.attachments_status ?? 'unknown',
    attachment_types: attachmentTypes(item),
    has_attachments: (item.attachments ?? []).length ? true : item.attachments_status === 'unknown' ? null : false,
    sources: sourceList(item),
    snippet,
    snippet_truncated: snippet.length < String(item.excerpt || item.body_text || '').length,
  };
  if (item.activity_type === 'repost') {
    view.activity_type = 'repost';
    view.forwarded_by = item.forwarded_by;
    view.original_published_at = item.original_published_at;
  }
  if (!view.snippet) delete view.snippet;
  return view;
}

export function itemDetail(item, timezone = 'Asia/Shanghai', { maxBodyChars = 4000 } = {}) {
  const body = String(item.body_text ?? '');
  const limit = Math.max(200, Math.min(8000, Number(maxBodyChars) || 4000));
  const bodyText = truncate(body, limit);
  const images = Array.isArray(item.images) ? item.images : [];
  return {
    item_id: item.id,
    title: item.title,
    author: item.author,
    author_uid: item.author_uid,
    url: item.url,
    published: formatInZone(item.published_at, timezone),
    published_at: item.published_at,
    content_type: item.content_type,
    duration_seconds: item.duration_seconds ?? null,
    duration: formatDuration(item.duration_seconds),
    body: bodyText,
    body_truncated: bodyText.length < body.length,
    text_available: Boolean(body.trim()),
    images,
    image_count: images.length,
    images_status: item.images_status ?? 'unknown',
    images_analyzed: false,
    attachments: item.attachments ?? [],
    attachments_status: item.attachments_status ?? 'unknown',
    attributions: buildingAttributions(item),
    sources: sourceList(item),
    activity_type: item.activity_type ?? null,
    repost_text: item.repost_text ?? '',
    forwarded_by: item.forwarded_by ?? null,
    original_published_at: item.original_published_at ?? null,
    dynamic_contexts: (item.dynamic_contexts ?? []).map((context) => ({
      author: context.author,
      url: context.url,
      published: formatInZone(context.published_at, timezone),
      text: truncate(context.text, 800),
    })),
    collected_at: item.collected_at,
    first_seen_at: item.first_seen_at,
    timezone,
  };
}

function buildingAttributions(item) {
  const body = String(item.body_text ?? '');
  const attributions = [];
  if (item.repost_text) {
    attributions.push({
      body_start: 0,
      body_end: body.length,
      author: item.forwarded_by,
      url: item.activity_url,
      role: 'forwarded_by',
    });
  }
  attributions.push({
    body_start: 0,
    body_end: body.length,
    author: item.author,
    url: item.url,
    published_at: item.published_at,
    role: item.activity_type === 'repost' ? 'original_author' : 'author',
  });
  return attributions;
}

export function refreshView(job, { timezone = 'Asia/Shanghai', retained = 0 } = {}) {
  const active = job.status === 'running';
  return {
    operation: 'refresh_sources',
    job_id: job.id ?? null,
    trigger: job.trigger ?? 'manual',
    status: job.status,
    operation_finished: job.status !== 'running',
    operation_succeeded: job.status === 'completed' ? true : job.status === 'failed' ? false : null,
    active,
    started_at: job.started_at ?? null,
    finished_at: job.finished_at ?? null,
    sources_total: job.sources_total ?? 0,
    requests_used: job.requests_used ?? 0,
    request_budget: job.request_budget ?? 0,
    data_completeness: job.data_completeness ?? 'unknown',
    data_complete: job.data_complete ?? null,
    retained_candidate_count: retained,
    coverage_note: '仅包含本轮采集及已保留内容；任务结束不代表所有更新均已取完。',
    warnings: job.warnings ?? [],
    stop_reason: job.stop_reason ?? null,
    sources: (job.targets ?? []).map((target) => ({
      kind: target.kind,
      key: target.key,
      label: target.label,
      status: target.status,
      count: target.candidates ?? 0,
      new_items: target.new_items ?? 0,
      batches: target.pages ?? 0,
      stop_reason: target.stop_reason ?? null,
      error: target.error ?? null,
    })),
    timezone,
  };
}

export function dataStatusMessage(status) {
  const messages = {
    no_enabled_sources: '没有启用的长期来源。可以先添加关键词、UP主或开启关注来源。',
    not_collected: '来源已保存但还没有采集：请刷新来源后再查询。',
    empty: '已采集但本地没有保留内容。',
    partial: '部分来源采集失败，已有内容仍可查询。',
    available: '已有本地保留内容可查询。',
    collection_failed: '最近的采集失败，历史内容仍可查询，新内容可能缺失。',
    old_snapshot_after_failure: '最近采集失败，只能查询旧的快照。',
  };
  return messages[status] ?? '';
}
