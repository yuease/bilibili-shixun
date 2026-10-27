export const ERROR_MESSAGES = {
  LOGIN_CANCELLED: '登录操作已取消或已被新的登录操作替代。',
  INVALID_ARGUMENT: '参数不合法：请检查名称、类型与取值范围。',
  AUTH_REQUIRED: '该来源需要先扫码登录B站。公开关键词搜索与搜索类读取仍然可用。',
  AUTH_EXPIRED: 'B站登录已失效：公开搜索仍可用，UP或关注来源需要重新扫码登录。',
  RATE_LIMITED: 'B站接口触发了风控或限流：请稍后再试，不要连续重试。',
  TIMEOUT: 'B站接口等待超时：结果未知，不要自动重复请求。',
  NETWORK: '无法连接B站接口：请检查本机网络后重试。',
  HTTP_ERROR: 'B站接口返回了异常状态码。',
  PARSE_ERROR: 'B站返回的数据结构无法识别：不要据此编造内容。',
  NOT_FOUND: '没有找到对应的本地条目或来源。',
  TOO_LARGE: '内容超出大小限制。',
  UNSUPPORTED: '当前环境不支持该操作。',
  SETTINGS_CONFLICT: '设置版本已变化：请先重新读取设置，再按新版本修改。',
  SETTINGS_UNDO_CONFLICT: '目标字段在此之后被修改过：拒绝覆盖，请重新读取设置。',
  NO_SOURCE: '还没有可采集的来源：请先添加关键词、UP主或关注来源。',
  BUSY: '已有任务在运行：请稍候或查询任务状态。',
  INTERNAL: '插件内部错误：操作未完成。',
};

export class BiliError extends Error {
  constructor(code, detail = '', extra = {}) {
    super(detail || ERROR_MESSAGES[code] || code);
    this.name = 'BiliError';
    this.code = code;
    this.detail = detail || ERROR_MESSAGES[code] || code;
    Object.assign(this, extra);
  }

  payload() {
    return { ok: false, error: { code: this.code, message: ERROR_MESSAGES[this.code] ?? this.detail } };
  }
}

export function asError(error) {
  if (error instanceof BiliError) return error;
  if (error?.name === 'AbortError') return new BiliError('TIMEOUT');
  if (error?.cause?.code === 'ENOTFOUND' || error?.code === 'ENOTFOUND') return new BiliError('NETWORK');
  return new BiliError('INTERNAL', String(error?.message ?? error));
}

export function errorPayload(error) {
  const err = asError(error);
  const payload = err.payload();
  if (err.code === 'INTERNAL' && err.detail) payload.error.detail = err.detail;
  if (err.extra && typeof err.extra === 'object') payload.error.detail = err.extra;
  return payload;
}
