/**
 * Model resolution with catalog fallbacks + known alias map from WindsurfAPI.
 */

export interface ResolvedModel {
  modelId: string;
  modelUid: string;
  variant?: string;
}

/**
 * Known OpenAI-ish aliases → upstream model selector (modelUid). The catalog is
 * still the source of truth, but when a client uses a shorthand or common alias
 * that the catalog doesn't directly expose, we resolve it here.
 */
const SELECTOR_MAP: Record<string, string> = {
  // SWE / Cognition
  "swe-1-6-slow": "swe-1-6-slow",
  "swe-1.6-slow": "swe-1-6-slow",
  "swe-1-6": "swe-1-6",
  "swe-1.6": "swe-1-6",
  "swe-1-6-fast": "swe-1-6-fast",
  "swe-1.6-fast": "swe-1-6-fast",
  "swe-1-5": "MODEL_SWE_1_5_SLOW",
  "swe-1.5": "MODEL_SWE_1_5_SLOW",
  "swe-1-5-fast": "MODEL_SWE_1_5",
  "swe-1.5-fast": "MODEL_SWE_1_5",
  "subagent-default": "subagent-default",

  // Anthropic
  "claude-opus-4-8": "claude-opus-4-8-medium",
  "claude-opus-4.8": "claude-opus-4-8-medium",
  "claude-opus-4-8-medium": "claude-opus-4-8-medium",
  "opus-4-8": "claude-opus-4-8-medium",
  "opus-4.8": "claude-opus-4-8-medium",
  "claude-sonnet-4.6": "claude-sonnet-4-6-thinking",
  "claude-sonnet-4-6-thinking": "claude-sonnet-4-6-thinking",
  "claude-opus-4-5": "MODEL_CLAUDE_4_5_OPUS",
  "claude-opus-4.5": "MODEL_CLAUDE_4_5_OPUS",
  "claude-opus-4-5-thinking": "MODEL_CLAUDE_4_5_OPUS_THINKING",
  "claude-sonnet-4-5": "MODEL_PRIVATE_2",
  "claude-sonnet-4.5": "MODEL_PRIVATE_2",
  "claude-sonnet-4-5-thinking": "MODEL_PRIVATE_3",
  "claude-haiku-4-5": "MODEL_PRIVATE_11",
  "claude-haiku-4.5": "MODEL_PRIVATE_11",

  // OpenAI
  "gpt-5-5": "gpt-5-5-low",
  "gpt-5.5": "gpt-5-5-low",
  "gpt-5-5-low": "gpt-5-5-low",
  "gpt-5.5-low": "gpt-5-5-low",
  "gpt-5-2": "MODEL_GPT_5_2_NONE",
  "gpt-5.2": "MODEL_GPT_5_2_NONE",
  "gpt-5-2-low": "MODEL_GPT_5_2_LOW",
  "gpt-5-2-medium": "MODEL_GPT_5_2_MEDIUM",
  "gpt-5-2-high": "MODEL_GPT_5_2_HIGH",
  "gpt-5-2-xhigh": "MODEL_GPT_5_2_XHIGH",

  // Google
  "gemini-3-0-flash": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3.0-flash": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3-flash": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3-flash-minimal": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL",
  "gemini-3-flash-low": "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW",
  "gemini-3-flash-medium": "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM",
  "gemini-3-flash-high": "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH",

  // Others
  "glm-5-2": "glm-5-2",
  "glm-5.2": "glm-5-2",
  "kimi-k2-7": "kimi-k2-7",

  // Additional paid aliases confirmed live
  "claude-5-fable": "claude-5-fable-medium",
  "claude-sonnet-5": "claude-sonnet-5-medium",
  "claude-opus-4-7": "claude-opus-4-7-medium",
  "claude-opus-4.7": "claude-opus-4-7-medium",
  "claude-opus-4.6": "claude-opus-4-6",
  "gpt-5-4": "gpt-5-4-medium",
  "gpt-5.4": "gpt-5-4-medium",
  "gpt-5-4-mini": "gpt-5-4-mini-medium",
  "gpt-5.4-mini": "gpt-5-4-mini-medium",
  "gpt-5-3-codex": "gpt-5-3-codex-medium",
  "gpt-5.3-codex": "gpt-5-3-codex-medium",
  "gemini-3-5-flash": "gemini-3-5-flash-medium",
  "gemini-3.5-flash": "gemini-3-5-flash-medium",
  "gemini-3-1-pro": "gemini-3-1-pro-low",
  "gemini-3.1-pro": "gemini-3-1-pro-low",
  "glm-5.1": "glm-5-2",
  "kimi-k2.6": "kimi-k2-6",
  "kimi-k2.7": "kimi-k2-7",
  "swe-1-7": "swe-1-7",
  "swe-1.7": "swe-1-7",
  "swe-1-7-lightning": "swe-1-7-lightning",
  "swe-1.7-lightning": "swe-1-7-lightning",
  "deepseek-v4": "deepseek-v4",
};

function resolveAlias(modelName: string): string | undefined {
  const raw = String(modelName || "").trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase().replace(/^[a-z]+\//, "");
  if (SELECTOR_MAP[lower]) return SELECTOR_MAP[lower];
  const norm = lower.replace(/\./g, "-");
  if (SELECTOR_MAP[norm]) return SELECTOR_MAP[norm];
  return undefined;
}

/**
 * Resolve a user-provided model name to a canonical UID.
 * Uses the catalog's display-name → UID mapping when available.
 * Falls back to pass-through if no catalog entry matches.
 */
export async function resolveModelName(
  modelName: string,
  apiKey?: string,
  host?: string,
  thinkingLevel?: string,
): Promise<ResolvedModel> {
  if (!apiKey || !host) return { modelId: modelName, modelUid: resolveAlias(modelName) ?? modelName };
  try {
    const { getCachedCatalog } = await import("./catalog");
    const catalog = await getCachedCatalog(apiKey, host);
    if (!catalog) return { modelId: modelName, modelUid: resolveAlias(modelName) ?? modelName };

    const match = findCatalogEntry(catalog, modelName);
    if (!match) {
      // Try WindsurfAPI alias map first, then family prefix search.
      const alias = resolveAlias(modelName);
      if (alias) return { modelId: modelName, modelUid: alias };
      const fallback = findFamilyEntry(catalog, modelName, thinkingLevel);
      if (fallback) return { modelId: modelName, modelUid: fallback.uid, variant: fallback.label };
      return { modelId: modelName, modelUid: modelName };
    }

    // Apply thinking level: find sibling in same family whose label contains the level
    if (thinkingLevel && catalog.byUid.size > 1) {
      const levelWord = thinkingLevelToWord(thinkingLevel);
      if (levelWord) {
        const sibling = findSiblingByLevel(catalog, match.uid, match.label, levelWord);
        if (sibling) return { modelId: modelName, modelUid: sibling.uid, variant: sibling.label };
      }
    }

    return { modelId: modelName, modelUid: match.uid, variant: match.label };
  } catch { /* catalog unavailable or broken — fall back to alias/passthrough */ }
  return { modelId: modelName, modelUid: resolveAlias(modelName) ?? modelName };
}

/** Map Pi thinking level string to a label-searchable word. */
function thinkingLevelToWord(level: string): string | null {
  const l = level.toLowerCase();
  if (l === "off") return "no";
  // Pi levels: minimal, low, medium, high, xhigh → search catalog labels
  return l;
}

/** Find a catalog entry by UID or label match. */
function findCatalogEntry(
  catalog: { byUid: Map<string, { modelUid: string; label: string }> },
  modelName: string,
): { uid: string; label: string } | null {
  const lower = modelName.toLowerCase();
  // Exact UID
  if (catalog.byUid.has(modelName)) {
    const e = catalog.byUid.get(modelName)!;
    return { uid: e.modelUid, label: e.label };
  }
  // Case-insensitive UID
  for (const [uid, entry] of catalog.byUid) {
    if (uid.toLowerCase() === lower) return { uid: entry.modelUid, label: entry.label };
  }
  // Display-name match
  for (const [, entry] of catalog.byUid) {
    if (entry.label.toLowerCase() === lower) return { uid: entry.modelUid, label: entry.label };
  }
  // Normalized match: "glm5.2" → "glm-5-2"
  const normalized = lower.replace(/[^a-z0-9]/g, "");
  for (const [uid, entry] of catalog.byUid) {
    const uidNorm = uid.toLowerCase().replace(/[^a-z0-9]/g, "");
    const labelNorm = entry.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (uidNorm === normalized || labelNorm === normalized) {
      return { uid: entry.modelUid, label: entry.label };
    }
  }
  return null;
}

/**
 * When input is a family prefix (e.g. "gpt-5-4"), find the best entry.
 * If thinkingLevel is given, prefer the matching variant.
 * Otherwise, prefer the first alphabetically (usually "high" or default).
 */
function findFamilyEntry(
  catalog: { byUid: Map<string, { modelUid: string; label: string }> },
  modelName: string,
  thinkingLevel?: string,
): { uid: string; label: string } | null {
  const lower = modelName.toLowerCase();
  // Find all UIDs that start with the model name followed by a hyphen
  const candidates: { uid: string; label: string }[] = [];
  for (const [uid, entry] of catalog.byUid) {
    if (uid.toLowerCase().startsWith(lower + "-") || uid.toLowerCase().startsWith(lower)) {
      candidates.push({ uid: entry.modelUid, label: entry.label });
    }
  }
  if (candidates.length === 0) return null;
  // If thinking level specified, try to find matching label
  if (thinkingLevel) {
    const levelWord = thinkingLevelToWord(thinkingLevel);
    if (levelWord) {
      for (const c of candidates) {
        if (c.label.toLowerCase().includes(levelWord)) return c;
      }
    }
  }
  // Return first candidate (default variant)
  return candidates[0];
}

/**
 * Find a sibling catalog entry whose label contains the thinking level word.
 * "Sibling" = entries sharing a UID prefix (same model family).
 * Completely data-driven from catalog labels — no hardcoded suffix lists.
 */
function findSiblingByLevel(
  catalog: { byUid: Map<string, { modelUid: string; label: string }> },
  currentUid: string,
  currentLabel: string,
  levelWord: string,
): { uid: string; label: string } | null {
  const currentLabelLower = currentLabel.toLowerCase();
  if (currentLabelLower.includes(levelWord)) {
    return { uid: currentUid, label: currentLabel };
  }
  // Search progressively shorter prefixes. Stop only on a label match or when exhausted.
  for (let len = currentUid.length - 1; len > 2; len--) {
    const prefix = currentUid.slice(0, len);
    const candidates: { uid: string; label: string }[] = [];
    for (const [uid, entry] of catalog.byUid) {
      if (uid === currentUid) continue;
      if (uid.startsWith(prefix)) {
        candidates.push({ uid: entry.modelUid, label: entry.label });
      }
    }
    if (candidates.length === 0) continue;
    for (const c of candidates) {
      if (c.label.toLowerCase().includes(levelWord)) return c;
    }
    // Found siblings but none match — keep searching shorter prefixes
  }
  return null;
}

/** Synchronous pass-through fallback — use resolveModelName when possible. */
export function resolveModelOrPassthrough(modelName: string): ResolvedModel {
  return { modelId: modelName, modelUid: modelName };
}

export function getDefaultModel(): string { return ""; }

export function getCanonicalModels(): string[] { return []; }
