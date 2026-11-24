import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  OFERTA_CATEGORIAS,
  type ExtractApiResponse,
  type ExtractedOffer,
} from "@/types/database";
import { resolveCategoryKey } from "@/lib/categoryAssets";
import { groupMercadosByChain, normalizeChainKey } from "@/lib/chains";
import {
  getSaoPauloCurrentYear,
  getSaoPauloOffsetIso,
  getSaoPauloTodayIso,
} from "@/lib/date";
import {
  CLAUDE_HAIKU_LABEL,
  CLAUDE_HAIKU_MODEL,
  ClaudeQuotaError,
  extractFlyerWithClaudeHaiku,
  getClaudeQuotaStatus,
  parseClaudeJsonResponse,
} from "@/lib/claudeExtract";

export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type SupportedClaudeMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

function getTodayIso(): string {
  return getSaoPauloTodayIso();
}

function getDefaultEndDate(): string {
  return getSaoPauloOffsetIso(5);
}

function normalizePrice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Number(value.toFixed(2)));
  }
  if (typeof value === "string") {
    const cleaned = value
      .replace(/R\$/gi, "")
      .replace(/\s+/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Number(parsed.toFixed(2)));
    }
  }
  return 0;
}

function normalizeCategory(value: unknown): string {
  if (typeof value !== "string") return "mercearia";
  const resolved = resolveCategoryKey(value);
  return OFERTA_CATEGORIAS.includes(
    resolved as (typeof OFERTA_CATEGORIAS)[number]
  )
    ? resolved
    : "mercearia";
}

function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

function normalizeDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();

  if (isValidIsoDate(trimmed)) {
    return trimmed;
  }

  // Fallback defensivo caso a IA retorne DD/MM/AAAA ou DD/MM
  const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, "0");
    const month = brMatch[2].padStart(2, "0");
    const rawYear = brMatch[3];
    const currentYear = String(getSaoPauloCurrentYear());
    const year = !rawYear
      ? currentYear
      : rawYear.length === 2
        ? `20${rawYear}`
        : rawYear;
    const candidate = `${year}-${month}-${day}`;
    if (isValidIsoDate(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

function sanitizeExtractedPayload(
  raw: unknown,
  validMercadoIds: Set<string>
): ExtractApiResponse {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawOffers = Array.isArray(obj.ofertas) ? obj.ofertas : [];

  const rawMercadoId =
    typeof obj.mercado_sugerido_id === "string"
      ? obj.mercado_sugerido_id.trim()
      : "";
  const mercadoSugeridoId =
    rawMercadoId &&
      rawMercadoId.toLowerCase() !== "null" &&
      validMercadoIds.has(rawMercadoId)
      ? rawMercadoId
      : null;

  const rawMercadoNome =
    typeof obj.mercado_nome_detectado === "string"
      ? obj.mercado_nome_detectado.trim()
      : "";
  const mercadoNomeDetectado =
    rawMercadoNome && rawMercadoNome.toLowerCase() !== "null"
      ? rawMercadoNome
      : null;

  const defaultStart = getTodayIso();
  const defaultEnd = getDefaultEndDate();
  const dataFimSugerida = normalizeDate(obj.data_fim_sugerida, defaultEnd);
  const rawStart = normalizeDate(obj.data_inicio_sugerida, defaultStart);
  const dataInicioSugerida =
    rawStart <= dataFimSugerida ? rawStart : dataFimSugerida;

  const ofertas: ExtractedOffer[] = rawOffers
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object")
    )
    .map((item) => {
      const precoOferta = normalizePrice(item.preco_oferta);
      const precoNormalRaw = normalizePrice(item.preco_normal);
      const precoNormal =
        precoNormalRaw >= precoOferta ? precoNormalRaw : precoOferta;

      return {
        produto_nome: String(item.produto_nome ?? "").trim(),
        marca: String(item.marca ?? "").trim(),
        peso_volume: String(item.peso_volume ?? "").trim(),
        categoria: normalizeCategory(item.categoria),
        preco_normal: precoNormal,
        preco_oferta: precoOferta,
        is_clube: Boolean(item.is_clube),
        data_fim: normalizeDate(item.data_fim, dataFimSugerida),
      };
    })
    .filter((item) => item.produto_nome.length > 0);

  return {
    mercado_sugerido_id: mercadoSugeridoId,
    mercado_nome_detectado: mercadoNomeDetectado,
    data_inicio_sugerida: dataInicioSugerida,
    data_fim_sugerida: dataFimSugerida,
    ofertas,
  };
}

type StaffAuthResult =
  | {
    ok: true;
    status: 200;
    supabase: SupabaseClient;
  }
  | {
    ok: false;
    status: number;
    error: string;
  };

async function authorizeStaffRequest(
  request: NextRequest
): Promise<StaffAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      status: 500,
      error: "Configuração do Supabase ausente no servidor.",
    };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Sessão não informada. Faça login para continuar.",
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Sessão inválida ou expirada. Faça login novamente.",
    };
  }

  const { data: perfil, error: perfilError } = await supabase
    .from("perfis")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (perfilError) {
    return {
      ok: false,
      status: 403,
      error: "Não foi possível validar suas permissões de colaborador.",
    };
  }

  const role = perfil?.role;
  if (role !== "admin" && role !== "colaborador") {
    return {
      ok: false,
      status: 403,
      error: "Acesso restrito a colaboradores autorizados.",
    };
  }

  return { ok: true, status: 200, supabase };
}

export async function GET(request: NextRequest) {
  const authCheck = await authorizeStaffRequest(request);
  if (!authCheck.ok) {
    return NextResponse.json(
      { error: authCheck.error },
      { status: authCheck.status }
    );
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const configured = Boolean(
    anthropicApiKey && anthropicApiKey !== "your-anthropic-api-key"
  );

  return NextResponse.json(
    {
      configured,
      model_used: CLAUDE_HAIKU_MODEL,
      model_label: CLAUDE_HAIKU_LABEL,
      quota: getClaudeQuotaStatus(),
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const authCheck = await authorizeStaffRequest(request);
    if (!authCheck.ok) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey || anthropicApiKey === "your-anthropic-api-key") {
      return NextResponse.json(
        {
          error:
            "ANTHROPIC_API_KEY não configurada no servidor (.env.local).",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Envie um arquivo de encarte válido (JPG, PNG ou PDF)." },
        { status: 400 }
      );
    }

    const normalizedMime =
      file.type === "image/jpg" ? "image/jpeg" : file.type;

    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return NextResponse.json(
        {
          error: `Formato não suportado (${file.type || "desconhecido"}). Use JPG, PNG, WEBP ou PDF.`,
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "O arquivo excede o limite máximo de 20 MB." },
        { status: 400 }
      );
    }

    const { data: mercadosData, error: mercadosError } = await authCheck.supabase
      .from("mercados")
      .select("id, nome_rede, unidade")
      .order("nome_rede", { ascending: true });

    if (mercadosError) {
      console.warn(
        "Não foi possível consultar a lista de mercados no Supabase:",
        mercadosError.message
      );
    }

    const mercadosCadastrados = Array.isArray(mercadosData)
      ? (mercadosData as Array<{ id: string; nome_rede: string; unidade: string }>)
      : [];
    const uniqueChains = groupMercadosByChain(mercadosCadastrados);
    const validMercadoIds = new Set(mercadosCadastrados.map((m) => m.id));
    const idToRepresentativeId = new Map<string, string>();
    for (const chain of uniqueChains) {
      for (const branch of chain.branches) {
        idToRepresentativeId.set(branch.id, chain.representativeId);
      }
    }

    const mercadosPromptList =
      uniqueChains.length > 0
        ? uniqueChains
          .map(
            (c) =>
              `- id: "${c.representativeId}" | nome_rede: "${c.nome_rede}" (Abrangência: Grande São Paulo)`
          )
          .join("\n")
        : "(Nenhuma rede cadastrada no momento)";

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");

    const todayIso = getTodayIso();
    const currentYear = getSaoPauloCurrentYear();
    const defaultEndIso = getDefaultEndDate();

    const prompt = `Você é um especialista em OCR e estruturação de encartes de supermercados brasileiros para o aplicativo CompreMatch.
Analise cuidadosamente a imagem/PDF deste encarte promocional e extraia TODAS as ofertas visíveis, a vigência e a identificação da rede de supermercados emissora.

Data atual de referência: ${todayIso} (ano corrente: ${currentYear}).

Identificação da rede de supermercado emissora:
As ofertas de encartes valem para toda a Grande São Paulo. Identifique nas imagens o logotipo ou nome da rede emissora (sem distinguir por bairro ou unidade). Compare com a lista de redes cadastradas a seguir e retorne o ID correspondente da rede mais compatível. Se não houver correspondência exata, retorne null.

Lista de redes cadastradas:
${mercadosPromptList}

Regras estritas de extração:
1. Retorne EXCLUSIVAMENTE um JSON válido seguindo exatamente o schema especificado.
2. Em "mercado_sugerido_id", retorne o UUID exato ("id") da rede mais compatível da lista acima ou null se não houver correspondência confiável. Em "mercado_nome_detectado", informe o nome da rede detectado na imagem (ou null se ilegível).
3. INSPECIONE ATIVAMENTE o cabeçalho, o rodapé, selos, faixas e letras miúdas de todo o encarte em busca de expressões de vigência/validade (ex.: "Ofertas válidas de DD/MM até DD/MM/AAAA", "Válido até DD/MM", "Preços válidos de...", "Promoção válida de ... a ...").
   - Converta a data inicial para "data_inicio_sugerida" e a data final para "data_fim_sugerida" no formato ISO "YYYY-MM-DD".
   - Se o ano for omitido no impresso (ex.: "20/11" ou "de 18/11 a 25/11"), assuma o ano corrente (${currentYear}).
   - Caso não consiga identificar nenhuma data de término no folheto, retorne exatamente "${defaultEndIso}" (5 dias à frente da data atual) em "data_fim_sugerida". Para "data_inicio_sugerida" não encontrada, use "${todayIso}".
4. Para cada oferta:
   - "produto_nome": nome claro do produto sem repetir marca/peso se já estiverem nos campos próprios (ex: "Arroz Branco Tipo 1").
   - "marca": fabricante/marca (ex: "Camil", "Pilão", "OMO"). Se não houver marca (ex: hortifrúti), use "".
   - "peso_volume": embalagem/peso/volume (ex: "5kg", "1L", "500g", "350ml").
   - "categoria": escolha RIGOROSAMENTE uma das chaves do enum a seguir: ${JSON.stringify(OFERTA_CATEGORIAS)}.
   - "preco_normal": preço de referência ("De:") como número decimal. Se apenas o preço promocional estiver visível, repita o valor de preco_oferta.
   - "preco_oferta": preço promocional ("Por:") como número decimal.
   - "is_clube": true se a oferta exigir aplicativo/clube de fidelidade do mercado (ex: "Clube", "App", "Meu Carrefour", "Cliente Mais"), caso contrário false.
   - "data_fim": data de validade específica deste item no formato "YYYY-MM-DD" caso o encarte indique prazo diferente para ele ou para sua seção (ex.: carnes ou hortifrúti com validade menor); caso contrário, repita o mesmo valor de "data_fim_sugerida".

Schema JSON esperado:
{
  "mercado_sugerido_id": "UUID_DO_MERCADO_OU_NULL",
  "mercado_nome_detectado": "Nome detectado na imagem (ex: Assaí Atacadista)",
  "data_inicio_sugerida": "YYYY-MM-DD",
  "data_fim_sugerida": "YYYY-MM-DD",
  "ofertas": [
    {
      "produto_nome": "Nome do Produto",
      "marca": "Marca",
      "peso_volume": "ex: 5kg, 1L",
      "categoria": "mercearia | matinais | bebidas | acougue | frios_laticinios | hortifruti | padaria | limpeza | descartaveis_embalagens | bazar_utilidades | higiene_pessoal | congelados | pet_shop | temperos_condimentos",
      "preco_normal": 0.00,
      "preco_oferta": 0.00,
      "is_clube": false,
      "data_fim": "YYYY-MM-DD"
    }
  ]
}`;

    const extractionResult = await extractFlyerWithClaudeHaiku({
      apiKey: anthropicApiKey,
      prompt,
      mimeType: normalizedMime as SupportedClaudeMime,
      base64Data,
      parseResponse: parseClaudeJsonResponse,
    });

    const payload = sanitizeExtractedPayload(
      extractionResult.parsed,
      validMercadoIds
    );
    payload.model_used = extractionResult.modelUsed;
    payload.model_label = extractionResult.modelLabel;
    payload.quota = extractionResult.quota;

    if (payload.mercado_sugerido_id) {
      payload.mercado_sugerido_id =
        idToRepresentativeId.get(payload.mercado_sugerido_id) ??
        payload.mercado_sugerido_id;
    } else if (payload.mercado_nome_detectado) {
      const detectedKey = normalizeChainKey(payload.mercado_nome_detectado);
      if (detectedKey.length >= 3) {
        const exactChain = uniqueChains.find((c) => c.key === detectedKey);
        const partialMatches = uniqueChains
          .filter(
            (c) => detectedKey.includes(c.key) || c.key.includes(detectedKey)
          )
          .sort((a, b) => b.key.length - a.key.length);
        const fallbackChain = exactChain ?? partialMatches[0] ?? null;
        if (fallbackChain) {
          payload.mercado_sugerido_id = fallbackChain.representativeId;
        }
      }
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    if (err instanceof ClaudeQuotaError) {
      console.warn("Limite/saldo da API do Claude atingido:", err.quota);
      return NextResponse.json(
        {
          error: err.message,
          code:
            err.quota.kind === "minute" ? "RATE_LIMITED" : "CREDITS_EXHAUSTED",
          quota: err.quota,
        },
        {
          status: err.status,
          headers: err.quota.retryAfterSeconds
            ? { "Retry-After": String(err.quota.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    console.error("Erro na rota /api/extract:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Erro ao extrair ofertas com IA: ${err.message}`
            : "Erro interno ao processar o encarte.",
      },
      { status: 500 }
    );
  }
}
