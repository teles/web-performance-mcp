export type Strategy = "mobile" | "desktop";

export type PageSpeedCategory =
  | "performance"
  | "accessibility"
  | "best-practices"
  | "seo"
  | "pwa";

export type Rating = "good" | "needs-improvement" | "poor" | "unknown";

export interface LighthouseAudit {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  numericUnit?: string;
  details?: {
    type?: string;
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
    items?: unknown[];
    [key: string]: unknown;
  };
  metricSavings?: Record<string, number>;
}

export interface PageSpeedApiResponse {
  id?: string;
  loadingExperience?: unknown;
  originLoadingExperience?: unknown;
  lighthouseResult?: {
    requestedUrl?: string;
    finalUrl?: string;
    fetchTime?: string;
    configSettings?: {
      emulatedFormFactor?: string;
      formFactor?: string;
      [key: string]: unknown;
    };
    categories?: Record<string, { title?: string; score?: number | null }>;
    audits?: Record<string, LighthouseAudit>;
  };
  analysisUTCTimestamp?: string;
}

export interface LabMetricSummary {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  displayValue: string | null;
  score: number | null;
  rating: Rating;
}

export interface AuditImpactSummary {
  id: string;
  title: string;
  score: number | null;
  displayValue: string | null;
  estimatedSavingsMs: number | null;
  estimatedSavingsBytes: number | null;
  impactScore: number;
  recommendation: string;
  items: AuditDetailItemSummary[];
}

export interface AuditDetailItemSummary {
  url: string | null;
  label: string | null;
  node: string | null;
  wastedMs: number | null;
  wastedBytes: number | null;
  totalBytes: number | null;
  transferSize: number | null;
  durationMs: number | null;
  blockingTimeMs: number | null;
}

export interface PageSpeedSummary {
  url: string;
  finalUrl: string | null;
  strategy: Strategy;
  fetchedAt: string | null;
  scores: Record<string, number | null>;
  labMetrics: Record<string, LabMetricSummary>;
  topAudits: AuditImpactSummary[];
  diagnostics: {
    renderBlockingResources: AuditDetailItemSummary[];
    unusedJavaScript: AuditDetailItemSummary[];
    unusedCss: AuditDetailItemSummary[];
    imageOptimizations: AuditDetailItemSummary[];
    longMainThreadTasks: AuditDetailItemSummary[];
    initialDocumentResponse: LabMetricSummary | null;
  };
  recommendations: string[];
}

export interface CruxApiResponse {
  record?: {
    key?: {
      url?: string;
      origin?: string;
      formFactor?: string;
    };
    metrics?: Record<string, CruxMetric>;
    collectionPeriod?: {
      firstDate?: { year: number; month: number; day: number };
      lastDate?: { year: number; month: number; day: number };
    };
  };
  urlNormalizationDetails?: {
    originalUrl?: string;
    normalizedUrl?: string;
  };
}

export interface CruxMetric {
  histogram?: Array<{
    start?: string | number;
    end?: string | number;
    density?: number;
  }>;
  percentiles?: {
    p75?: string | number;
  };
}

export interface CruxMetricSummary {
  id: "lcp" | "inp" | "cls";
  label: string;
  p75: number | null;
  unit: "ms" | "score";
  rating: Rating;
  distribution: {
    good: number;
    needsImprovement: number;
    poor: number;
  };
}

export interface CruxSummary {
  available: boolean;
  scope: "url" | "origin";
  requested: string;
  normalized: string | null;
  collectionPeriod: string | null;
  metrics: {
    lcp: CruxMetricSummary | null;
    inp: CruxMetricSummary | null;
    cls: CruxMetricSummary | null;
  };
  reason?: string;
}

export interface ComparisonItem {
  url: string;
  priorityScore: number;
  pageSpeed: {
    performanceScore: number | null;
    lab: {
      lcpMs: number | null;
      inpProxyTbtMs: number | null;
      cls: number | null;
      fcpMs: number | null;
    };
  } | null;
  crux: {
    available: boolean;
    lcpP75Ms: number | null;
    inpP75Ms: number | null;
    clsP75: number | null;
    ratings: {
      lcp: Rating;
      inp: Rating;
      cls: Rating;
    };
  } | null;
  topProblems: string[];
  nextActions: string[];
}
