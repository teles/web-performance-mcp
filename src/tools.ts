import { mapWithConcurrency } from "./concurrency.js";
import { explainGoogleApiError, GoogleApiClient } from "./googleApis.js";
import {
  comparePerformanceItems,
  noCruxDataSummary,
  summarizeCruxRecord,
  summarizePageSpeed,
} from "./transforms.js";
import type { CruxSummary, PageSpeedSummary } from "./types.js";
import {
  normalizeCategories,
  normalizeConcurrency,
  normalizeOrigin,
  normalizeStrategy,
  normalizeUrl,
  normalizeUrlList,
} from "./validation.js";

export interface ToolContext {
  client: GoogleApiClient;
}

type CompactLab = ReturnType<typeof compactLab>;

type PageSpeedBatchResult =
  | {
      url: string;
      ok: true;
      scores: Record<string, number | null>;
      labMetrics: CompactLab;
      topAudits: PageSpeedSummary["topAudits"];
      recommendations: string[];
    }
  | {
      url: string;
      ok: false;
      error: ReturnType<typeof explainGoogleApiError>;
    };

export async function analyzePageSpeed(args: unknown, context: ToolContext): Promise<unknown> {
  const input = argsAsRecord(args);
  const url = normalizeUrl(input.url);
  const strategy = normalizeStrategy(input.strategy);
  const categories = normalizeCategories(input.categories);
  const response = await context.client.runPageSpeed(url, strategy, categories);
  return summarizePageSpeed(response, url, strategy);
}

export async function analyzePageSpeedBatch(args: unknown, context: ToolContext): Promise<unknown> {
  const input = argsAsRecord(args);
  const urls = normalizeUrlList(input.urls, 10);
  const strategy = normalizeStrategy(input.strategy);
  const categories = normalizeCategories(input.categories);
  const concurrency = normalizeConcurrency(input.concurrency);

  const results = await mapWithConcurrency<string, PageSpeedBatchResult>(urls, concurrency, async (url) => {
    try {
      const response = await context.client.runPageSpeed(url, strategy, categories);
      const summary = summarizePageSpeed(response, url, strategy);
      return {
        url,
        ok: true,
        scores: summary.scores,
        labMetrics: compactLab(summary),
        topAudits: summary.topAudits.slice(0, 4),
        recommendations: summary.recommendations.slice(0, 4),
      };
    } catch (error) {
      return {
        url,
        ok: false,
        error: explainGoogleApiError(error),
      };
    }
  });

  const sortable = results
    .filter((item): item is Extract<PageSpeedBatchResult, { ok: true }> => item.ok)
    .map((item) => ({
      url: item.url,
      performanceScore: item.scores.performance ?? null,
      lcpMs: item.labMetrics.lcpMs,
      tbtMs: item.labMetrics.tbtMs,
      cls: item.labMetrics.cls,
    }))
    .sort((a, b) => {
      const scoreA = a.performanceScore ?? -1;
      const scoreB = b.performanceScore ?? -1;
      return scoreA - scoreB || (b.lcpMs ?? 0) - (a.lcpMs ?? 0);
    });

  return {
    strategy,
    categories,
    concurrency,
    count: urls.length,
    comparison: sortable,
    results,
  };
}

export async function getCruxUrl(args: unknown, context: ToolContext): Promise<CruxSummary> {
  const input = argsAsRecord(args);
  const url = normalizeUrl(input.url);
  try {
    const response = await context.client.queryCruxUrl(url);
    return summarizeCruxRecord(response, url, "url");
  } catch (error) {
    const explained = explainGoogleApiError(error);
    if (explained.status === 404) {
      return noCruxDataSummary(url, "url", explained.message);
    }
    throw error;
  }
}

export async function getCruxOrigin(args: unknown, context: ToolContext): Promise<CruxSummary> {
  const input = argsAsRecord(args);
  const origin = normalizeOrigin(input.origin);
  try {
    const response = await context.client.queryCruxOrigin(origin);
    return summarizeCruxRecord(response, origin, "origin");
  } catch (error) {
    const explained = explainGoogleApiError(error);
    if (explained.status === 404) {
      return noCruxDataSummary(origin, "origin", explained.message);
    }
    throw error;
  }
}

export async function compareWebPerformance(args: unknown, context: ToolContext): Promise<unknown> {
  const input = argsAsRecord(args);
  const urls = normalizeUrlList(input.urls, 10);
  const strategy = normalizeStrategy(input.strategy);
  const categories = normalizeCategories(input.categories ?? ["performance"]);
  const concurrency = normalizeConcurrency(input.concurrency);

  const results = await mapWithConcurrency(urls, concurrency, async (url) => {
    let pageSpeed: PageSpeedSummary | null = null;
    let crux: CruxSummary | null = null;
    const errors: string[] = [];

    const [pageSpeedResult, cruxResult] = await Promise.allSettled([
      context.client.runPageSpeed(url, strategy, categories),
      context.client.queryCruxUrl(url),
    ]);

    if (pageSpeedResult.status === "fulfilled") {
      pageSpeed = summarizePageSpeed(pageSpeedResult.value, url, strategy);
    } else {
      errors.push(`PageSpeed: ${explainGoogleApiError(pageSpeedResult.reason).message}`);
    }

    if (cruxResult.status === "fulfilled") {
      crux = summarizeCruxRecord(cruxResult.value, url, "url");
    } else {
      const explained = explainGoogleApiError(cruxResult.reason);
      crux =
        explained.status === 404
          ? noCruxDataSummary(url, "url", explained.message)
          : null;
      if (!crux) errors.push(`CrUX: ${explained.message}`);
    }

    return {
      url,
      pageSpeed,
      crux,
      error: errors.length ? errors.join(" ") : undefined,
    };
  });

  const prioritized = comparePerformanceItems(results);

  return {
    strategy,
    categories,
    concurrency,
    count: urls.length,
    prioritized,
    highestPriority: prioritized.slice(0, 3),
  };
}

function compactLab(summary: PageSpeedSummary): {
  fcpMs: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
} {
  return {
    fcpMs: summary.labMetrics["first-contentful-paint"]?.value ?? null,
    lcpMs: summary.labMetrics["largest-contentful-paint"]?.value ?? null,
    tbtMs: summary.labMetrics["total-blocking-time"]?.value ?? null,
    cls: summary.labMetrics["cumulative-layout-shift"]?.value ?? null,
    speedIndexMs: summary.labMetrics["speed-index"]?.value ?? null,
  };
}

function argsAsRecord(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args as Record<string, unknown>;
}
