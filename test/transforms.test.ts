import { describe, expect, it } from "vitest";
import {
  comparePerformanceItems,
  noCruxDataSummary,
  summarizeCruxRecord,
  summarizePageSpeed,
} from "../src/transforms.js";
import type { CruxApiResponse, PageSpeedApiResponse } from "../src/types.js";

describe("summarizePageSpeed", () => {
  it("gera um resumo compacto com scores, metricas, auditorias e recomendacoes", () => {
    const response: PageSpeedApiResponse = {
      lighthouseResult: {
        finalUrl: "https://example.com/",
        fetchTime: "2026-06-13T01:00:00.000Z",
        categories: {
          performance: { score: 0.42 },
          seo: { score: 0.92 },
        },
        audits: {
          "first-contentful-paint": {
            score: 0.4,
            numericValue: 2400,
            displayValue: "2.4 s",
          },
          "largest-contentful-paint": {
            score: 0.2,
            numericValue: 5200,
            displayValue: "5.2 s",
          },
          "total-blocking-time": {
            score: 0.1,
            numericValue: 880,
            displayValue: "880 ms",
          },
          "cumulative-layout-shift": {
            score: 0.3,
            numericValue: 0.32,
            displayValue: "0.32",
          },
          "render-blocking-resources": {
            title: "Eliminate render-blocking resources",
            description: "Resources are blocking the first paint.",
            score: 0,
            displayValue: "Potential savings of 900 ms",
            details: {
              overallSavingsMs: 900,
            },
          },
          "uses-responsive-images": {
            title: "Properly size images",
            score: 0.5,
            displayValue: "80 KiB",
            details: {
              overallSavingsBytes: 81920,
            },
          },
        },
      },
    };

    const summary = summarizePageSpeed(response, "https://example.com/", "mobile");

    expect(summary.scores.performance).toBe(42);
    expect(summary.scores.seo).toBe(92);
    expect(summary.labMetrics["largest-contentful-paint"]).toMatchObject({
      value: 5200,
      rating: "poor",
    });
    expect(summary.labMetrics["cumulative-layout-shift"]).toMatchObject({
      value: 0.32,
      rating: "poor",
    });
    expect(summary.topAudits[0]).toMatchObject({
      id: "render-blocking-resources",
      estimatedSavingsMs: 900,
    });
    expect(summary.recommendations.join(" ")).toContain("LCP");
    expect(JSON.stringify(summary)).not.toContain("lighthouseResult");
  });
});

describe("summarizeCruxRecord", () => {
  it("resume p75 e distribuicoes de LCP, INP e CLS", () => {
    const response: CruxApiResponse = {
      record: {
        key: { url: "https://example.com/" },
        collectionPeriod: {
          firstDate: { year: 2026, month: 5, day: 1 },
          lastDate: { year: 2026, month: 5, day: 28 },
        },
        metrics: {
          largest_contentful_paint: {
            histogram: [
              { start: 0, end: 2500, density: 0.61 },
              { start: 2500, end: 4000, density: 0.24 },
              { start: 4000, density: 0.15 },
            ],
            percentiles: { p75: 3100 },
          },
          interaction_to_next_paint: {
            histogram: [
              { start: 0, end: 200, density: 0.81 },
              { start: 200, end: 500, density: 0.13 },
              { start: 500, density: 0.06 },
            ],
            percentiles: { p75: 180 },
          },
          cumulative_layout_shift: {
            histogram: [
              { start: 0, end: 0.1, density: 0.7 },
              { start: 0.1, end: 0.25, density: 0.2 },
              { start: 0.25, density: 0.1 },
            ],
            percentiles: { p75: "0.18" },
          },
        },
      },
      urlNormalizationDetails: {
        originalUrl: "https://example.com",
        normalizedUrl: "https://example.com/",
      },
    };

    const summary = summarizeCruxRecord(response, "https://example.com/", "url");

    expect(summary.available).toBe(true);
    expect(summary.normalized).toBe("https://example.com/");
    expect(summary.collectionPeriod).toBe("2026-05-01..2026-05-28");
    expect(summary.metrics.lcp).toMatchObject({
      p75: 3100,
      rating: "needs-improvement",
      distribution: { good: 61, needsImprovement: 24, poor: 15 },
    });
    expect(summary.metrics.inp).toMatchObject({ p75: 180, rating: "good" });
    expect(summary.metrics.cls).toMatchObject({ p75: 0.18, rating: "needs-improvement" });
  });

  it("representa URLs sem dados CrUX sem quebrar a ferramenta", () => {
    const summary = summarizeCruxRecord({}, "https://new.example/", "url");

    expect(summary.available).toBe(false);
    expect(summary.reason).toContain("Sem dados CrUX");
    expect(summary.metrics).toEqual({ lcp: null, inp: null, cls: null });
  });
});

describe("comparePerformanceItems", () => {
  it("prioriza URLs com piores sinais combinados de laboratorio e campo", () => {
    const weakPageSpeed = summarizePageSpeed(
      {
        lighthouseResult: {
          categories: { performance: { score: 0.31 } },
          audits: {
            "largest-contentful-paint": { numericValue: 6200, score: 0.1, displayValue: "6.2 s" },
            "total-blocking-time": { numericValue: 740, score: 0.2, displayValue: "740 ms" },
            "cumulative-layout-shift": { numericValue: 0.28, score: 0.2, displayValue: "0.28" },
            "render-blocking-resources": {
              title: "Eliminate render-blocking resources",
              score: 0,
              details: { overallSavingsMs: 1200 },
            },
          },
        },
      },
      "https://slow.example/",
      "mobile",
    );

    const strongPageSpeed = summarizePageSpeed(
      {
        lighthouseResult: {
          categories: { performance: { score: 0.94 } },
          audits: {
            "largest-contentful-paint": { numericValue: 1500, score: 0.95 },
            "total-blocking-time": { numericValue: 40, score: 1 },
            "cumulative-layout-shift": { numericValue: 0.01, score: 1 },
          },
        },
      },
      "https://fast.example/",
      "mobile",
    );

    const slowCrux = summarizeCruxRecord(
      {
        record: {
          key: { url: "https://slow.example/" },
          metrics: {
            largest_contentful_paint: { percentiles: { p75: 4600 }, histogram: [{ density: 0.4 }, { density: 0.2 }, { density: 0.4 }] },
            interaction_to_next_paint: { percentiles: { p75: 560 }, histogram: [{ density: 0.5 }, { density: 0.2 }, { density: 0.3 }] },
            cumulative_layout_shift: { percentiles: { p75: 0.3 }, histogram: [{ density: 0.6 }, { density: 0.2 }, { density: 0.2 }] },
          },
        },
      },
      "https://slow.example/",
      "url",
    );

    const comparison = comparePerformanceItems([
      { url: "https://fast.example/", pageSpeed: strongPageSpeed, crux: noCruxDataSummary("https://fast.example/", "url") },
      { url: "https://slow.example/", pageSpeed: weakPageSpeed, crux: slowCrux },
    ]);

    expect(comparison[0].url).toBe("https://slow.example/");
    expect(comparison[0].priorityScore).toBeGreaterThan(comparison[1].priorityScore);
    expect(comparison[0].topProblems.join(" ")).toContain("CrUX ruim");
    expect(comparison[0].nextActions.join(" ")).toContain("JavaScript");
  });
});
