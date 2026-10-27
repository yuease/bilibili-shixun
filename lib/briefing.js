import { formatDuration, formatInZone, nowIso, truncate } from './util.js';

const MAX_CANDIDATES = 60;

/**
 * Build model-ready briefing material from retained items. No LLM call: the
 * calling agent writes the briefing, so summaries can never be invented here.
 */
export function buildBriefing(store, params = {}, { timezone = 'Asia/Shanghai' } = {}) {
  const query = store.queryItems(
    {
      terms: params.terms ?? [],
      time_range: params.time_range,
      content_types: params.content_types,
      sources: params.sources,
      has_images: params.has_images,
      max_duration_seconds: params.max_duration_seconds,
      limit: 10,
      page: 1,
    },
    { timezone },
  );
  const maxPicks = Math.max(1, Math.min(10, Number(params.max_picks) || 5));
  const bySource = new Map();
  for (const item of query.rows.slice(0, 400)) {
    const key = (item.sources ?? ['unknown'])[0];
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(item);
  }
  for (const list of bySource.values()) {
    list.sort((a, b) => Date.parse(b.published_at ?? 0) - Date.parse(a.published_at ?? 0));
  }
  // Round-robin across sources so one chatty source cannot fill the briefing.
  const candidates = [];
  let added = true;
  while (added && candidates.length < MAX_CANDIDATES) {
    added = false;
    for (const list of bySource.values()) {
      const next = list.shift();
      if (!next) continue;
      candidates.push(next);
      added = true;
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }

  const picks = candidates.slice(0, maxPicks).map((item) => ({
    item_id: item.id,
    title: item.title,
    author: item.author,
    published: formatInZone(item.published_at, timezone),
    published_at: item.published_at ?? null,
    url: item.url,
    content_type: item.content_type,
    duration_seconds: item.duration_seconds ?? null,
    duration: formatDuration(item.duration_seconds),
    tags: item.tags ?? [],
    excerpt: truncate(item.body_text || item.excerpt || '', 600),
    image_count: item.image_count ?? 0,
    images_status: item.images_status ?? 'unknown',
    attachments_status: item.attachments_status ?? 'unknown',
    source_labels: (item.sources ?? []).map((tag) => String(tag).replace(':', ' · ')),
    activity_type: item.activity_type ?? null,
    forwarded_by: item.forwarded_by ?? null,
    original_published_at: item.original_published_at ?? null,
  }));

  return {
    ok: true,
    operation: 'briefing_material',
    generated_at: nowIso(),
    timezone,
    interests: store.settings.interests || '',
    outcome: query.outcome,
    coverage: query.coverage,
    requested_sources: query.requested_sources,
    candidate_count: candidates.length,
    picks,
    guidance:
      '以上只是已采集内容的证据素材，不是结论。请只依据 title/excerpt/url 等字段写简报：不要声称看过视频或验证过内容，不要推测图片内容、播放量或热度；' +
      '每条保留原文链接、作者与发布时间；缺少文字时说明“B站未提供可用文字，请打开原文查看”；' +
      '没有命中或来源失败要说清是本地未采集，而不是B站没有更新。',
  };
}
