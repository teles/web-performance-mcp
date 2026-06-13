import type {
  CruxApiResponse,
  PageSpeedApiResponse,
  PageSpeedCategory,
  Strategy,
} from "./types.js";

const PAGESPEED_ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

const CATEGORY_TO_API: Record<PageSpeedCategory, string> = {
  performance: "PERFORMANCE",
  accessibility: "ACCESSIBILITY",
  "best-practices": "BEST_PRACTICES",
  seo: "SEO",
  pwa: "PWA",
};

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface GoogleApiClientOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class GoogleApiClient {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleApiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY ?? "";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.PERF_API_TIMEOUT_MS ?? 30000);
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.apiKey) {
      throw new GoogleApiError("GOOGLE_API_KEY nao configurada.");
    }
  }

  async runPageSpeed(
    url: string,
    strategy: Strategy,
    categories: PageSpeedCategory[],
  ): Promise<PageSpeedApiResponse> {
    const endpoint = new URL(PAGESPEED_ENDPOINT);
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", strategy);
    endpoint.searchParams.set("key", this.apiKey);
    for (const category of categories) {
      endpoint.searchParams.append("category", CATEGORY_TO_API[category]);
    }

    return this.requestJson<PageSpeedApiResponse>(endpoint, { method: "GET" });
  }

  async queryCruxUrl(url: string): Promise<CruxApiResponse> {
    return this.queryCrux({ url });
  }

  async queryCruxOrigin(origin: string): Promise<CruxApiResponse> {
    return this.queryCrux({ origin });
  }

  private async queryCrux(body: { url: string } | { origin: string }): Promise<CruxApiResponse> {
    const endpoint = new URL(CRUX_ENDPOINT);
    endpoint.searchParams.set("key", this.apiKey);
    return this.requestJson<CruxApiResponse>(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new GoogleApiError(`Timeout apos ${this.timeoutMs}ms ao consultar API Google.`, 408, "TIMEOUT");
      }
      throw new GoogleApiError("Falha de rede ao consultar API Google.", undefined, "NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const apiError = extractApiError(payload);
      throw new GoogleApiError(apiError.message, response.status, apiError.reason);
    }

    return payload as T;
  }
}

export function explainGoogleApiError(error: unknown): { message: string; status?: number; reason?: string } {
  if (error instanceof GoogleApiError) {
    if (error.status === 403 || error.status === 429) {
      return {
        message: "Quota, permissao ou limite da API Google atingido. Verifique faturamento, APIs habilitadas e limites do projeto.",
        status: error.status,
        reason: error.reason,
      };
    }

    if (error.status === 404) {
      return {
        message: "Sem dados disponiveis para esta URL/origem na API consultada.",
        status: error.status,
        reason: error.reason,
      };
    }

    return { message: error.message, status: error.status, reason: error.reason };
  }

  return {
    message: error instanceof Error ? error.message : "Erro desconhecido.",
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new GoogleApiError("Resposta JSON invalida da API Google.", response.status, "INVALID_JSON");
  }
}

function extractApiError(payload: unknown): { message: string; reason?: string } {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return { message: "Erro retornado pela API Google." };
  }

  const error = (payload as { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } }).error;
  return {
    message: error?.message ?? "Erro retornado pela API Google.",
    reason: error?.status ?? error?.errors?.[0]?.reason,
  };
}
