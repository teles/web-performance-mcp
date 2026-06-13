#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { explainGoogleApiError, GoogleApiClient } from "./googleApis.js";
import {
  analyzePageSpeed,
  analyzePageSpeedBatch,
  compareWebPerformance,
  getCruxOrigin,
  getCruxUrl,
} from "./tools.js";

const tools: Tool[] = [
  {
    name: "analyze_pagespeed",
    description:
      "Analisa uma URL com PageSpeed Insights API v5 e retorna scores, metricas de laboratorio, auditorias de maior impacto e recomendacoes compactas.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL http/https a analisar." },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile" },
        categories: {
          type: "array",
          items: {
            type: "string",
            enum: ["performance", "accessibility", "best-practices", "seo", "pwa"],
          },
          default: ["performance"],
        },
      },
      required: ["url"],
    },
  },
  {
    name: "analyze_pagespeed_batch",
    description:
      "Analisa ate 10 URLs com PageSpeed Insights API v5, com limite de concorrencia, e retorna uma comparacao compacta.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          maxItems: 10,
          items: { type: "string" },
          description: "Lista de ate 10 URLs http/https.",
        },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile" },
        categories: {
          type: "array",
          items: {
            type: "string",
            enum: ["performance", "accessibility", "best-practices", "seo", "pwa"],
          },
          default: ["performance"],
        },
        concurrency: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          default: 2,
          description: "Numero maximo de URLs consultadas em paralelo.",
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "get_crux_url",
    description:
      "Consulta a Chrome UX Report API para uma URL e retorna LCP, INP, CLS e distribuicoes good/needs improvement/poor.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL http/https a consultar no CrUX." },
      },
      required: ["url"],
    },
  },
  {
    name: "get_crux_origin",
    description:
      "Consulta a Chrome UX Report API para uma origem e retorna LCP, INP, CLS e distribuicoes good/needs improvement/poor agregadas.",
    inputSchema: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Origem http/https, por exemplo https://www.example.com.",
        },
      },
      required: ["origin"],
    },
  },
  {
    name: "compare_web_performance",
    description:
      "Compara varias URLs combinando PageSpeed Insights e CrUX, priorizando os maiores problemas de Core Web Vitals e laboratorio.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          maxItems: 10,
          items: { type: "string" },
          description: "Lista de ate 10 URLs http/https.",
        },
        strategy: { type: "string", enum: ["mobile", "desktop"], default: "mobile" },
        categories: {
          type: "array",
          items: {
            type: "string",
            enum: ["performance", "accessibility", "best-practices", "seo", "pwa"],
          },
          default: ["performance"],
        },
        concurrency: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          default: 2,
        },
      },
      required: ["urls"],
    },
  },
];

type Handler = (args: unknown, context: { client: GoogleApiClient }) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  analyze_pagespeed: analyzePageSpeed,
  analyze_pagespeed_batch: analyzePageSpeedBatch,
  get_crux_url: getCruxUrl,
  get_crux_origin: getCruxOrigin,
  compare_web_performance: compareWebPerformance,
};

async function main(): Promise<void> {
  const server = new Server(
    {
      name: "web-performance-mcp",
      version: readPackageVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = handlers[request.params.name];
    if (!handler) {
      return errorResponse(`Ferramenta desconhecida: ${request.params.name}`);
    }

    let client: GoogleApiClient;
    try {
      client = new GoogleApiClient();
    } catch (error) {
      return errorResponse(explainGoogleApiError(error));
    }

    try {
      const result = await handler(request.params.arguments ?? {}, { client });
      return jsonResponse(result);
    } catch (error) {
      return errorResponse(explainGoogleApiError(error));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function readPackageVersion(): string {
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      readFileSync(join(distDir, "../package.json"), "utf8"),
    ) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function jsonResponse(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResponse(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const payload =
    typeof error === "string"
      ? { message: error }
      : error && typeof error === "object"
        ? error
        : { message: "Erro desconhecido." };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: payload }, null, 2),
      },
    ],
  };
}

main().catch((error) => {
  const explained = explainGoogleApiError(error);
  process.stderr.write(`${explained.message}\n`);
  process.exit(1);
});
