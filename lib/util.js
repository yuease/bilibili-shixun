import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const PLUGIN_NAME = 'dsh-bilibili-shixun';
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function nowIso() {
  return new Date().toISOString();
}

export function hashId(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20);
}

export function randomId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

/** Atomic JSON write: write a sibling temp file, then rename over the target. */
export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, file);
}

export function truncate(text, max) {
  const value = String(text ?? '');
  if (!Number.isFinite(max) || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<em[^>]*>/gi, '')
    .replace(/<\/em>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return HTML_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .trim();
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tzOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour') % 24, pick('minute'), pick('second'));
  return asUtc - date.getTime();
}

function safeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Start of the calendar day containing `reference` in `timeZone`, as a UTC Date. */
export function startOfDay(timeZone, reference = new Date()) {
  const zone = safeZone(timeZone);
  const offset = tzOffsetMs(zone, reference);
  const local = new Date(reference.getTime() + offset);
  const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const guess = midnightUtc - offset;
  return new Date(midnightUtc - tzOffsetMs(zone, new Date(guess)));
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

/** Parse a user-supplied date bound; date-only values are local midnight in `timeZone`. */
export function parseDateBound(value, timeZone) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    const zone = safeZone(timeZone);
    const guess = Date.UTC(year, month - 1, day);
    const offset = tzOffsetMs(zone, new Date(guess));
    const instant = new Date(guess - offset);
    return new Date(Date.UTC(year, month - 1, day) - tzOffsetMs(zone, instant));
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    const [datePart, timePart] = text.replace('T', ' ').split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second = 0] = timePart.split(':').map(Number);
    const zone = safeZone(timeZone);
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    return new Date(guess - tzOffsetMs(zone, new Date(guess)));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatInZone(iso, timeZone) {
  if (!iso) return '未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知';
  const zone = safeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

export function toIso(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const pieces = match.slice(1).filter((part) => part !== undefined).map(Number);
  const seconds = pieces.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function clampInt(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}
