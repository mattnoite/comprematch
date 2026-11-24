import type { ExtractQuotaStatus } from "@/types/database";

export const CLAUDE_HAIKU_MODEL = "claude-haiku-5-5";
export const CLAUDE_HAIKU_LABEL = "Claude Haiku 5.5";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 32768;
const REQUEST_TIMEOUT_MS = 55_000;

type ClaudeMediaMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string | null;
  error?: {
    type?: string;
    message?: string;
  };
}

interface QuotaStore {
  exhausted: ExtractQuotaStatus | null;
}

const globalForClaudeQuota = globalThis as typeof globalThis & {
  __comprematchClaudeQuota?: QuotaStore;
};

function getQuotaStore(): QuotaStore {
  if (!globalForClaudeQuota.__comprematchClaudeQuota) {
    globalForClaudeQuota.__comprematchClaudeQuota = { exhausted: null };
  }
  return globalForClaudeQuota.__comprematchClaudeQuota;
}

export function getClaudeQuotaStatus(): ExtractQuotaStatus {
  const store = getQuotaStore();
  const current = store.exhausted;

  if (!current) {
    return {
      exhausted: false,
      kind: "none",
      retryAfterSeconds: null,
      resetAtIso: null,
    };
  }

  if (current.resetAtIso) {
    const resetMs = Date.parse(current.resetAtIso);
    if (Number.isFinite(resetMs) && Date.now() >= resetMs) {
      store.exhausted = null;
      return {
        exhausted: false,
        kind: "none",
        retryAfterSeconds: null,
        resetAtIso: null,
      };
    }
  }

  return current;
}

export function clearClaudeQuotaStatus() {
  getQuotaStore().exhausted = null;
}

export class ClaudeQuotaError extends Error {
  public readonly status: number;
  public readonly quota: ExtractQuotaStatus;

  constructor(message: string, status: number, quota: ExtractQuotaStatus) {
    super(message);
    this.name = "ClaudeQuotaError";
    this.status = status;
    this.quota = quota;
  }
}

export function parseClaudeJsonResponse(rawText: string): unknown {
  const cleanedJson = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleanedJson);
  } catch {
    const startIdx = cleanedJson.indexOf("{");
    const endIdx = cleanedJson.lastIndexOf("}");
    if (startIdx >= 0 && endIdx > startIdx) {
      return JSON.parse(cleanedJson.slice(startIdx, endIdx + 1));
    }
    throw new Error("A IA retornou uma resposta fora do formato JSON esperado.");
  }
}

function buildMediaContentBlock(
  mimeType: ClaudeMediaMime,
  base64Data: string
): Record<string, unknown> {
  if (mimeType === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64Data,
      },
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mimeType,
      data: base64Data,
    },
  };
}

export async function extractFlyerWithClaudeHaiku<T>(params: {
  apiKey: string;
  prompt: string;
  mimeType: ClaudeMediaMime;
  base64Data: string;
  parseResponse: (rawText: string) => T;
}): Promise<{
  parsed: T;
  modelUsed: string;
  modelLabel: string;
  quota: ExtractQuotaStatus;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: CLAUDE_HAIKU_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: "disabled" },
        system:
          "Você é um extrator rigoroso de dados de encartes de supermercados brasileiros. Responda EXCLUSIVAMENTE com um objeto JSON válido seguindo exatamente o schema solicitado, sem texto introdutório, explicações ou blocos markdown.",
        messages: [
          {
            role: "user",
            content: [
              buildMediaContentBlock(params.mimeType, params.base64Data),
              {
                type: "text",
                text: params.prompt,
              },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "A leitura do encarte pela IA atingiu o tempo limite. Tente dividir em páginas menores."
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = (await response
    .json()
    .catch(() => null)) as AnthropicMessageResponse | null;

  if (!response.ok) {
    const errorType = payload?.error?.type ?? "";
    const errorMsg = payload?.error?.message ?? `HTTP ${response.status}`;
    const lower = `${errorType} ${errorMsg}`.toLowerCase();

    if (response.status === 401 || lower.includes("authentication_error")) {
      throw new Error(
        "Chave ANTHROPIC_API_KEY inválida ou expirada no servidor."
      );
    }

    if (
      lower.includes("credit balance") ||
      lower.includes("billing") ||
      lower.includes("insufficient_quota") ||
      lower.includes("usage limit") ||
      response.status === 402
    ) {
      const quota: ExtractQuotaStatus = {
        exhausted: true,
        kind: "credits",
        retryAfterSeconds: null,
        resetAtIso: null,
      };
      getQuotaStore().exhausted = quota;
      throw new ClaudeQuotaError(
        "Saldo ou limite de créditos da API do Claude esgotado. Adicione créditos em platform.claude.com ou use o Cadastro Manual.",
        429,
        quota
      );
    }

    if (response.status === 429 || lower.includes("rate_limit")) {
      const retryHeader = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10
      );
      const retryAfterSeconds =
        Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 60;
      const quota: ExtractQuotaStatus = {
        exhausted: true,
        kind: "minute",
        retryAfterSeconds,
        resetAtIso: new Date(
          Date.now() + retryAfterSeconds * 1000
        ).toISOString(),
      };
      getQuotaStore().exhausted = quota;
      throw new ClaudeQuotaError(
        "Limite temporário de requisições do Claude Haiku atingido. Aguarde alguns segundos e tente novamente.",
        429,
        quota
      );
    }

    throw new Error(`Claude API (${response.status}): ${errorMsg}`);
  }

  clearClaudeQuotaStatus();

  const textBlocks = (payload?.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "");

  const rawText = textBlocks.join("\n").trim();
  if (!rawText) {
    throw new Error(
      "O Claude Haiku retornou uma resposta vazia para este encarte."
    );
  }

  if (payload?.stop_reason === "max_tokens") {
    throw new Error(
      "O encarte possui muitos itens e excedeu o tamanho máximo de saída em uma única chamada. Tente enviar páginas menores."
    );
  }

  const parsed = params.parseResponse(rawText);
  return {
    parsed,
    modelUsed: CLAUDE_HAIKU_MODEL,
    modelLabel: CLAUDE_HAIKU_LABEL,
    quota: getClaudeQuotaStatus(),
  };
}
