/**
 * Minimal model resolution — catalog is the single source of truth.
 *
 * This file only exists because the proxy needs synchronous model resolution.
 * All model metadata, UIDs, pricing, promos come from the catalog.
 */

export interface ResolvedModel {
  modelId: string;
  modelUid: string;
  variant?: string;
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
): Promise<ResolvedModel> {
  if (!apiKey || !host) return { modelId: modelName, modelUid: modelName };
  try {
    const { getCachedCatalog } = await import("./catalog");
    const catalog = await getCachedCatalog(apiKey, host);
    if (!catalog) return { modelId: modelName, modelUid: modelName };
    const lower = modelName.toLowerCase();
    // Exact UID match
    if (catalog.byUid.has(modelName)) {
      const entry = catalog.byUid.get(modelName)!;
      return { modelId: modelName, modelUid: entry.modelUid, variant: entry.label };
    }
    // Case-insensitive UID match
    for (const [uid, entry] of catalog.byUid) {
      if (uid.toLowerCase() === lower) {
        return { modelId: modelName, modelUid: entry.modelUid, variant: entry.label };
      }
    }
    // Display-name match (field 1 in catalog)
    for (const [, entry] of catalog.byUid) {
      if (entry.label.toLowerCase() === lower) {
        return { modelId: modelName, modelUid: entry.modelUid, variant: entry.label };
      }
    }
    // Partial match: "glm5.2" → "glm-5-2", "GLM-5.2 High" → "glm-5-2"
    const normalized = lower.replace(/[^a-z0-9]/g, "");
    for (const [uid, entry] of catalog.byUid) {
      const uidNorm = uid.toLowerCase().replace(/[^a-z0-9]/g, "");
      const labelNorm = entry.label.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (uidNorm === normalized || labelNorm === normalized) {
        return { modelId: modelName, modelUid: entry.modelUid, variant: entry.label };
      }
    }
  } catch {}
  return { modelId: modelName, modelUid: modelName };
}

/** Synchronous pass-through fallback — use resolveModelName when possible. */
export function resolveModelOrPassthrough(modelName: string): ResolvedModel {
  return { modelId: modelName, modelUid: modelName };
}

export function getDefaultModel(): string { return ""; }

export function getCanonicalModels(): string[] { return []; }
