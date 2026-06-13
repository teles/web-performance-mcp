import type { PageSpeedCategory, Strategy } from "./types.js";

const CATEGORY_ALIASES: Record<string, PageSpeedCategory> = {
  performance: "performance",
  accessibility: "accessibility",
  "best-practices": "best-practices",
  best_practices: "best-practices",
  bestpractices: "best-practices",
  seo: "seo",
  pwa: "pwa",
};

export function normalizeUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("URL obrigatoria.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`URL invalida: ${String(value)}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("A URL deve usar http ou https.");
  }

  parsed.hash = "";
  return parsed.href;
}

export function normalizeOrigin(value: unknown): string {
  const url = normalizeUrl(value);
  return new URL(url).origin;
}

export function normalizeStrategy(value: unknown): Strategy {
  if (value === undefined || value === null || value === "") return "mobile";
  if (value === "mobile" || value === "desktop") return value;
  throw new Error("strategy deve ser mobile ou desktop.");
}

export function normalizeCategories(value: unknown): PageSpeedCategory[] {
  if (value === undefined || value === null) return ["performance"];
  if (!Array.isArray(value)) {
    throw new Error("categories deve ser uma lista.");
  }

  const categories = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("categories deve conter apenas strings.");
    }
    const normalized = CATEGORY_ALIASES[item.trim().toLowerCase()];
    if (!normalized) {
      throw new Error(
        `Categoria invalida: ${item}. Use performance, accessibility, best-practices, seo ou pwa.`,
      );
    }
    return normalized;
  });

  return [...new Set(categories)].length ? [...new Set(categories)] : ["performance"];
}

export function normalizeUrlList(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) {
    throw new Error("urls deve ser uma lista.");
  }

  if (!value.length) {
    throw new Error("Informe ao menos uma URL.");
  }

  if (value.length > max) {
    throw new Error(`Informe no maximo ${max} URLs.`);
  }

  return value.map(normalizeUrl);
}

export function normalizeConcurrency(value: unknown): number {
  if (value === undefined || value === null || value === "") return 2;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error("concurrency deve ser um inteiro entre 1 e 5.");
  }
  return parsed;
}
