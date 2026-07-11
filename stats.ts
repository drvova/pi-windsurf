/**
 * Lightweight session usage statistics for the Windsurf Pi provider.
 *
 * Tracks per-request and cumulative token usage (fresh input, cache read,
 * cache write, output, total, requests with usage). No disk persistence,
 * only in-memory session state, surfaced via /windsurf-status and a tool.
 */

export interface ChatUsageStats {
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  requestsWithUsage: number;
  requests: number;
  success: number;
  errors: number;
  lastModel?: string;
  lastUpdatedAt?: number;
}

interface UsageRecord {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  cascadeBreakdown?: {
    freshInputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
  };
}

let _state: ChatUsageStats = {
  freshInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  total: 0,
  requestsWithUsage: 0,
  requests: 0,
  success: 0,
  errors: 0,
};

function getOrCreate<K extends string, V>(map: Record<K, V | undefined>, key: K, factory: () => V): V {
  if (!map[key]) map[key] = factory();
  return map[key] as V;
}

export function recordChatUsage(
  model: string,
  success: boolean,
  usage?: UsageRecord | null,
): ChatUsageStats {
  _state.requests += 1;
  if (success) _state.success += 1;
  else _state.errors += 1;
  _state.lastModel = model;
  _state.lastUpdatedAt = Date.now();

  if (!usage) return _state;

  const bd = usage.cascadeBreakdown;
  const fresh = bd?.freshInputTokens ?? Math.max(0, (usage.promptTokens ?? 0) - (usage.cachedInputTokens ?? 0));
  const cacheR = bd?.cacheReadTokens ?? (usage.cachedInputTokens ?? 0);
  const cacheW = bd?.cacheWriteTokens ?? (usage.cacheCreationInputTokens ?? 0);
  const output = bd?.outputTokens ?? (usage.completionTokens ?? 0);
  const total = fresh + cacheR + cacheW + output;

  if (fresh || cacheR || cacheW || output) {
    _state.freshInput += fresh;
    _state.cacheRead += cacheR;
    _state.cacheWrite += cacheW;
    _state.output += output;
    _state.total += total;
    _state.requestsWithUsage += 1;
  }

  return _state;
}

export function getChatUsage(): ChatUsageStats {
  return { ..._state };
}

export function resetChatUsage(): ChatUsageStats {
  _state = {
    freshInput: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    total: 0,
    requestsWithUsage: 0,
    requests: 0,
    success: 0,
    errors: 0,
  };
  return _state;
}

export function formatChatUsage(s: ChatUsageStats): string {
  const lines: string[] = [];
  lines.push(`Requests: ${s.requests} (success ${s.success}, errors ${s.errors})`);
  if (s.requestsWithUsage > 0) {
    lines.push(`Tokens: total ${s.total}, fresh ${s.freshInput}, cache read ${s.cacheRead}, cache write ${s.cacheWrite}, output ${s.output}`);
    lines.push(`Usage coverage: ${s.requestsWithUsage}/${s.requests} requests`);
  }
  if (s.lastModel) lines.push(`Last model: ${s.lastModel}`);
  return lines.join("\n");
}
