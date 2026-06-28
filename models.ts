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

/** Pass-through: the raw model name IS the UID. Catalog handles resolution. */
export function resolveModelOrPassthrough(modelName: string): ResolvedModel {
  return { modelId: modelName, modelUid: modelName };
}

export function getDefaultModel(): string { return ""; }

export function getCanonicalModels(): string[] { return []; }
