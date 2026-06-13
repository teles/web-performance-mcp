import type {
  AuditImpactSummary,
  AuditDetailItemSummary,
  ComparisonItem,
  CruxApiResponse,
  CruxMetric,
  CruxMetricSummary,
  CruxSummary,
  LabMetricSummary,
  LighthouseAudit,
  PageSpeedApiResponse,
  PageSpeedSummary,
  Rating,
  Strategy,
} from "./types.js";

const LAB_AUDITS: Array<{ id: string; label: string; unit: "ms" | "score" }> = [
  { id: "first-contentful-paint", label: "FCP", unit: "ms" },
  { id: "largest-contentful-paint", label: "LCP", unit: "ms" },
  { id: "speed-index", label: "Speed Index", unit: "ms" },
  { id: "total-blocking-time", label: "TBT", unit: "ms" },
  { id: "cumulative-layout-shift", label: "CLS", unit: "score" },
  { id: "interactive", label: "TTI", unit: "ms" },
  { id: "server-response-time", label: "TTFB", unit: "ms" },
];

const AUDIT_RECOMMENDATIONS: Array<[RegExp, string]> = [
  [/render-blocking|critical request|critical path/i, "Reduza CSS/JS bloqueante com critical CSS, defer e remocao de dependencias nao criticas."],
  [/image|offscreen|modern image|properly size|uses-responsive-images/i, "Otimize imagens: dimensoes corretas, formatos modernos, lazy-load fora da primeira dobra e preload do LCP."],
  [/unused javascript|legacy javascript|bootup|main-thread|third-party/i, "Corte ou adie JavaScript, especialmente bibliotecas globais e terceiros fora do caminho critico."],
  [/unused css|css/i, "Remova CSS nao usado e mantenha o CSS critico pequeno para acelerar o primeiro render."],
  [/font|text/i, "Reduza familias/pesos de fontes, use font-display: swap e preconnect ou self-host."],
  [/layout shift|cls/i, "Reserve espaco para imagens, embeds e banners antes do carregamento para evitar deslocamentos."],
  [/server|initial server response|ttfb/i, "Melhore cache/CDN e tempo de resposta do HTML inicial."],
];

export function summarizePageSpeed(
  response: PageSpeedApiResponse,
  requestedUrl: string,
  strategy: Strategy,
): PageSpeedSummary {
  const lighthouse = response.lighthouseResult;
  const audits = lighthouse?.audits ?? {};

  const scores = Object.fromEntries(
    Object.entries(lighthouse?.categories ?? {}).map(([key, category]) => [
      key,
      typeof category.score === "number" ? Math.round(category.score * 100) : null,
    ]),
  );

  const labMetrics = Object.fromEntries(
    LAB_AUDITS.map((metric) => [metric.id, summarizeLabMetric(metric.id, metric.label, metric.unit, audits[metric.id])]),
  ) as Record<string, LabMetricSummary>;

  const topAudits = summarizeAudits(audits, 8);
  const diagnostics = {
    renderBlockingResources: detailItemsFor(audits, [
      "render-blocking-insight",
      "render-blocking-resources",
    ]),
    unusedJavaScript: detailItemsFor(audits, ["unused-javascript"]),
    unusedCss: detailItemsFor(audits, ["unused-css-rules"]),
    imageOptimizations: detailItemsFor(audits, [
      "image-delivery-insight",
      "uses-optimized-images",
      "uses-responsive-images",
      "modern-image-formats",
      "offscreen-images",
    ]),
    longMainThreadTasks: detailItemsFor(audits, [
      "long-tasks",
      "mainthread-work-breakdown",
      "bootup-time",
    ]),
    initialDocumentResponse: labMetrics["server-response-time"] ?? null,
  };
  const recommendations = buildPageSpeedRecommendations(labMetrics, topAudits);

  return {
    url: requestedUrl,
    finalUrl: lighthouse?.finalUrl ?? lighthouse?.requestedUrl ?? null,
    strategy,
    fetchedAt: lighthouse?.fetchTime ?? response.analysisUTCTimestamp ?? null,
    scores,
    labMetrics,
    topAudits,
    diagnostics,
    recommendations,
  };
}

export function summarizeCruxRecord(
  response: CruxApiResponse,
  requested: string,
  scope: "url" | "origin",
): CruxSummary {
  const record = response.record;
  if (!record?.metrics) {
    return {
      available: false,
      scope,
      requested,
      normalized: response.urlNormalizationDetails?.normalizedUrl ?? null,
      collectionPeriod: null,
      metrics: { lcp: null, inp: null, cls: null },
      reason: "Sem dados CrUX suficientes para esta URL/origem.",
    };
  }

  return {
    available: true,
    scope,
    requested,
    normalized:
      response.urlNormalizationDetails?.normalizedUrl ??
      record.key?.url ??
      record.key?.origin ??
      null,
    collectionPeriod: formatCollectionPeriod(record.collectionPeriod),
    metrics: {
      lcp: summarizeCruxMetric("lcp", "LCP", "ms", record.metrics.largest_contentful_paint),
      inp: summarizeCruxMetric("inp", "INP", "ms", record.metrics.interaction_to_next_paint),
      cls: summarizeCruxMetric("cls", "CLS", "score", record.metrics.cumulative_layout_shift),
    },
  };
}

export function noCruxDataSummary(
  requested: string,
  scope: "url" | "origin",
  reason = "Sem dados CrUX para esta URL/origem.",
): CruxSummary {
  return {
    available: false,
    scope,
    requested,
    normalized: null,
    collectionPeriod: null,
    metrics: { lcp: null, inp: null, cls: null },
    reason,
  };
}

export function comparePerformanceItems(
  items: Array<{
    url: string;
    pageSpeed?: PageSpeedSummary | null;
    crux?: CruxSummary | null;
    error?: string;
  }>,
): ComparisonItem[] {
  return items
    .map(({ url, pageSpeed, crux, error }) => {
      const problems: string[] = [];
      const actions = new Set<string>();
      let priorityScore = error ? 20 : 0;

      const performanceScore = pageSpeed?.scores.performance ?? null;
      const lcp = pageSpeed?.labMetrics["largest-contentful-paint"]?.value ?? null;
      const tbt = pageSpeed?.labMetrics["total-blocking-time"]?.value ?? null;
      const cls = pageSpeed?.labMetrics["cumulative-layout-shift"]?.value ?? null;
      const fcp = pageSpeed?.labMetrics["first-contentful-paint"]?.value ?? null;

      if (performanceScore !== null) {
        priorityScore += Math.max(0, 100 - performanceScore) * 0.7;
        if (performanceScore < 50) problems.push(`PageSpeed performance baixo (${performanceScore}/100).`);
      }

      addLabProblem("LCP lab", lcp, 2500, 4000, "ms", problems, actions, "Priorizar elemento LCP e reduzir render delay.", (points) => {
        priorityScore += points;
      });
      addLabProblem("TBT lab", tbt, 200, 600, "ms", problems, actions, "Reduzir/adier JavaScript no main thread.", (points) => {
        priorityScore += points;
      });
      addLabProblem("CLS lab", cls, 0.1, 0.25, "", problems, actions, "Reservar espaco estavel para banners, imagens e embeds.", (points) => {
        priorityScore += points;
      });

      if (crux?.available) {
        for (const metric of [crux.metrics.lcp, crux.metrics.inp, crux.metrics.cls]) {
          if (!metric) continue;
          if (metric.rating === "poor") {
            priorityScore += 28;
            problems.push(`${metric.label} CrUX ruim no p75 (${formatMetricValue(metric.p75, metric.unit)}).`);
          } else if (metric.rating === "needs-improvement") {
            priorityScore += 14;
            problems.push(`${metric.label} CrUX precisa melhorar no p75 (${formatMetricValue(metric.p75, metric.unit)}).`);
          }
        }
      } else if (crux) {
        problems.push("Sem dados CrUX de URL; use origem como fallback quando fizer sentido.");
      }

      for (const audit of pageSpeed?.topAudits.slice(0, 3) ?? []) {
        if (audit.impactScore <= 0) continue;
        problems.push(`${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ""}.`);
        actions.add(audit.recommendation);
        priorityScore += Math.min(20, audit.impactScore / 10);
      }

      if (error) {
        problems.push(error);
        actions.add("Reexecutar a consulta depois de validar URL, quota e chave da API.");
      }

      return {
        url,
        priorityScore: Math.round(priorityScore),
        pageSpeed: pageSpeed
          ? {
              performanceScore,
              lab: {
                lcpMs: lcp,
                inpProxyTbtMs: tbt,
                cls,
                fcpMs: fcp,
              },
            }
          : null,
        crux: crux
          ? {
              available: crux.available,
              lcpP75Ms: crux.metrics.lcp?.p75 ?? null,
              inpP75Ms: crux.metrics.inp?.p75 ?? null,
              clsP75: crux.metrics.cls?.p75 ?? null,
              ratings: {
                lcp: crux.metrics.lcp?.rating ?? "unknown",
                inp: crux.metrics.inp?.rating ?? "unknown",
                cls: crux.metrics.cls?.rating ?? "unknown",
              },
            }
          : null,
        topProblems: unique(problems).slice(0, 7),
        nextActions: unique([...actions]).slice(0, 6),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function summarizeLabMetric(
  id: string,
  label: string,
  unit: "ms" | "score",
  audit?: LighthouseAudit,
): LabMetricSummary {
  const value = typeof audit?.numericValue === "number" ? roundMetric(audit.numericValue, unit) : null;
  return {
    id,
    label,
    value,
    unit,
    displayValue: audit?.displayValue ?? null,
    score: typeof audit?.score === "number" ? round(audit.score, 3) : null,
    rating: rateLabMetric(id, value),
  };
}

function summarizeAudits(
  audits: Record<string, LighthouseAudit>,
  limit: number,
): AuditImpactSummary[] {
  return Object.entries(audits)
    .map(([id, audit]) => summarizeAuditImpact(id, audit))
    .filter((audit) => audit.impactScore > 0)
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, limit);
}

function summarizeAuditImpact(id: string, audit: LighthouseAudit): AuditImpactSummary {
  const scorePenalty =
    typeof audit.score === "number" && audit.score < 0.9 && !["manual", "notApplicable"].includes(audit.scoreDisplayMode ?? "")
      ? (1 - audit.score) * 100
      : 0;
  const estimatedSavingsMs = firstNumber(
    audit.details?.overallSavingsMs,
    audit.metricSavings?.LCP,
    audit.metricSavings?.FCP,
    audit.metricSavings?.TBT,
  );
  const estimatedSavingsBytes = firstNumber(audit.details?.overallSavingsBytes);
  const impactScore =
    scorePenalty +
    (estimatedSavingsMs ?? 0) / 10 +
    (estimatedSavingsBytes ?? 0) / 20480;
  const title = audit.title ?? id;

  return {
    id,
    title,
    score: typeof audit.score === "number" ? round(audit.score, 3) : null,
    displayValue: audit.displayValue ?? null,
    estimatedSavingsMs: estimatedSavingsMs === null ? null : Math.round(estimatedSavingsMs),
    estimatedSavingsBytes: estimatedSavingsBytes === null ? null : Math.round(estimatedSavingsBytes),
    impactScore: Math.round(impactScore),
    recommendation: recommendationForAudit(id, title, audit.description),
    items: compactAuditItems(audit).slice(0, 6),
  };
}

function detailItemsFor(
  audits: Record<string, LighthouseAudit>,
  ids: string[],
): AuditDetailItemSummary[] {
  const items = ids.flatMap((id) => compactAuditItems(audits[id]));
  return dedupeAuditItems(items).slice(0, 10);
}

function compactAuditItems(audit?: LighthouseAudit): AuditDetailItemSummary[] {
  const rawItems = Array.isArray(audit?.details?.items) ? audit.details.items : [];
  return rawItems
    .map((item) => compactAuditItem(item))
    .filter((item) => item.url || item.label || item.node || item.durationMs !== null || item.wastedBytes !== null);
}

function compactAuditItem(item: unknown): AuditDetailItemSummary {
  const record = isRecord(item) ? item : {};
  const source = isRecord(record.source) ? record.source : {};
  const request = isRecord(record.request) ? record.request : {};
  const node = isRecord(record.node) ? record.node : {};
  const entity = isRecord(record.entity) ? record.entity : {};

  const url =
    firstString(record.url, request.url, source.url, record.scriptUrl, record.sourceURL) ??
    null;
  const label =
    firstString(record.label, record.name, record.groupLabel, record.resourceType, entity.text) ??
    null;
  const nodeText =
    firstString(node.selector, node.snippet, node.nodeLabel, record.selector) ??
    null;

  return {
    url,
    label,
    node: nodeText,
    wastedMs: nullableRoundedNumber(record.wastedMs, record.savingsMs, record.overallSavingsMs),
    wastedBytes: nullableRoundedNumber(record.wastedBytes, record.wastedByteSavings),
    totalBytes: nullableRoundedNumber(record.totalBytes, record.resourceBytes),
    transferSize: nullableRoundedNumber(record.transferSize, record.transferSizeBytes),
    durationMs: nullableRoundedNumber(record.duration, record.total, record.mainThreadTime),
    blockingTimeMs: nullableRoundedNumber(record.blockingTime, record.tbtImpact),
  };
}

function buildPageSpeedRecommendations(
  metrics: Record<string, LabMetricSummary>,
  audits: AuditImpactSummary[],
): string[] {
  const recommendations = new Set<string>();

  const lcp = metrics["largest-contentful-paint"]?.value;
  const tbt = metrics["total-blocking-time"]?.value;
  const cls = metrics["cumulative-layout-shift"]?.value;
  const fcp = metrics["first-contentful-paint"]?.value;
  const ttfb = metrics["server-response-time"]?.value;

  if (lcp !== null && lcp > 2500) {
    recommendations.add("Priorize o elemento LCP: preload/fetchpriority, dimensoes explicitas e menos render delay.");
  }
  if (fcp !== null && fcp > 1800) {
    recommendations.add("Reduza recursos bloqueantes antes do primeiro conteudo: CSS critico pequeno e scripts deferidos.");
  }
  if (tbt !== null && tbt > 200) {
    recommendations.add("Reduza JavaScript no main thread e adie scripts que nao participam da primeira dobra.");
  }
  if (cls !== null && cls > 0.1) {
    recommendations.add("Reserve espaco para imagens, banners, carrosseis e embeds para estabilizar o layout.");
  }
  if (ttfb !== null && ttfb > 800) {
    recommendations.add("Revise cache/CDN e tempo de resposta do HTML inicial.");
  }

  for (const audit of audits.slice(0, 5)) {
    recommendations.add(audit.recommendation);
  }

  return [...recommendations].slice(0, 7);
}

function summarizeCruxMetric(
  id: "lcp" | "inp" | "cls",
  label: string,
  unit: "ms" | "score",
  metric?: CruxMetric,
): CruxMetricSummary | null {
  if (!metric) return null;
  const p75 = parseNumber(metric.percentiles?.p75);
  const histogram = metric.histogram ?? [];
  const distribution = {
    good: percent(histogram[0]?.density),
    needsImprovement: percent(histogram[1]?.density),
    poor: percent(histogram[2]?.density),
  };

  return {
    id,
    label,
    p75: p75 === null ? null : roundMetric(p75, unit),
    unit,
    rating: rateCruxMetric(id, p75),
    distribution,
  };
}

function rateLabMetric(id: string, value: number | null): Rating {
  if (value === null) return "unknown";
  switch (id) {
    case "largest-contentful-paint":
      return thresholdRating(value, 2500, 4000);
    case "first-contentful-paint":
      return thresholdRating(value, 1800, 3000);
    case "total-blocking-time":
      return thresholdRating(value, 200, 600);
    case "cumulative-layout-shift":
      return thresholdRating(value, 0.1, 0.25);
    case "speed-index":
      return thresholdRating(value, 3400, 5800);
    case "interactive":
      return thresholdRating(value, 3800, 7300);
    case "server-response-time":
      return thresholdRating(value, 800, 1800);
    default:
      return "unknown";
  }
}

function rateCruxMetric(id: "lcp" | "inp" | "cls", value: number | null): Rating {
  if (value === null) return "unknown";
  if (id === "lcp") return thresholdRating(value, 2500, 4000);
  if (id === "inp") return thresholdRating(value, 200, 500);
  return thresholdRating(value, 0.1, 0.25);
}

function thresholdRating(value: number, goodMax: number, poorMin: number): Rating {
  if (value <= goodMax) return "good";
  if (value <= poorMin) return "needs-improvement";
  return "poor";
}

function recommendationForAudit(id: string, title: string, description?: string): string {
  const text = `${id} ${title} ${description ?? ""}`;
  return AUDIT_RECOMMENDATIONS.find(([pattern]) => pattern.test(text))?.[1] ?? "Priorize esta auditoria de maior impacto antes de micro-otimizacoes.";
}

function addLabProblem(
  label: string,
  value: number | null,
  warn: number,
  poor: number,
  unit: string,
  problems: string[],
  actions: Set<string>,
  action: string,
  addScore: (points: number) => void,
): void {
  if (value === null) return;
  if (value > poor) {
    problems.push(`${label} ruim (${formatNumber(value)}${unit}).`);
    actions.add(action);
    addScore(25);
  } else if (value > warn) {
    problems.push(`${label} precisa melhorar (${formatNumber(value)}${unit}).`);
    actions.add(action);
    addScore(12);
  }
}

function formatCollectionPeriod(period?: CruxApiResponse["record"] extends infer R ? R extends { collectionPeriod?: infer P } ? P : never : never): string | null {
  if (!period || typeof period !== "object") return null;
  const first = "firstDate" in period ? period.firstDate : undefined;
  const last = "lastDate" in period ? period.lastDate : undefined;
  if (!first || !last) return null;
  return `${formatDate(first)}..${formatDate(last)}`;
}

function formatDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number {
  const parsed = parseNumber(value) ?? 0;
  return round(parsed * 100, 2);
}

function roundMetric(value: number, unit: "ms" | "score"): number {
  return unit === "ms" ? Math.round(value) : round(value, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatMetricValue(value: number | null, unit: "ms" | "score"): string {
  if (value === null) return "n/d";
  return unit === "ms" ? `${Math.round(value)}ms` : String(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value, 3));
}

function dedupeAuditItems(items: AuditDetailItemSummary[]): AuditDetailItemSummary[] {
  const seen = new Set<string>();
  const result: AuditDetailItemSummary[] = [];
  for (const item of items) {
    const key = `${item.url ?? ""}|${item.label ?? ""}|${item.node ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function nullableRoundedNumber(...values: unknown[]): number | null {
  const value = firstNumber(...values);
  return value === null ? null : Math.round(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
