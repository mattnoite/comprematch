import { NextResponse, type NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  OFERTA_CATEGORIAS,
  type ExtractApiResponse,
  type ExtractedOffer,
} from "@/types/database";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

const GEMINI_MODEL_CANDIDATES: ReadonlyArray<{
  model: string;
  apiVersion: "v1" | "v1beta";
}> = [
  { model: "gemini-3.8-flash", apiVersion: "v1" },
  { model: "gemini-3.8-flash", apiVersion: "v1beta" },
  { model: "gemini-flash-latest", apiVersion: "v1beta" },
  { model: "gemini-flash-lite-latest", apiVersion: "v1beta" },
];

async function generateWithGeminiFallback(
  genAI: GoogleGenerativeAI,
  parts: Parameters<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>[0],
  generationConfig: { responseMimeType: string; temperature: number }
): Promise<string> {
  let lastError: unknown;

  for (const candidate of GEMINI_MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel(
        {
          model: candidate.model,
          generationConfig,
        },
        { apiVersion: candidate.apiVersion }
      );
      const result = await model.generateContent(parts);
      return result.response.text();
    } catch (err) {
      lastError = err;
      console.warn(
        `Falha com ${candidate.model} (${candidate.apiVersion}), tentando próximo fallback:`,
        err
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Nenhum modelo Gemini disponível respondeu com sucesso.");
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultEndDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
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
  if (typeof value !== "string") return "Mercearia";
  const trimmed = value.trim();
  const matched = OFERTA_CATEGORIAS.find(
    (cat) => cat.toLowerCase() === trimmed.toLowerCase()
  );
  return matched ?? (trimmed || "Mercearia");
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
    const currentYear = String(new Date().getFullYear());
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

export async function POST(request: NextRequest) {
  try {
    const authCheck = await authorizeStaffRequest(request);
    if (!authCheck.ok) {
      return NextResponse.json(
        { error: authCheck.error },
        { status: authCheck.status }
      );
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey || geminiApiKey === "your-gemini-api-key") {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY não configurada no servidor (.env.local).",
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
    const validMercadoIds = new Set(mercadosCadastrados.map((m) => m.id));

    const mercadosPromptList =
      mercadosCadastrados.length > 0
        ? mercadosCadastrados
            .map(
              (m) =>
                `- id: "${m.id}" | nome_rede: "${m.nome_rede}" | unidade: "${m.unidade}"`
            )
            .join("\n")
        : "(Nenhum mercado cadastrado no momento)";

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const todayIso = getTodayIso();
    const currentYear = new Date().getFullYear();
    const defaultEndIso = getDefaultEndDate();

    const prompt = `Você é um especialista em OCR e estruturação de encartes de supermercados brasileiros para o aplicativo CompreMatch.
Analise cuidadosamente a imagem/PDF deste encarte promocional e extraia TODAS as ofertas visíveis, a vigência e a identificação do supermercado emissor.

Data atual de referência: ${todayIso} (ano corrente: ${currentYear}).

Identificação do supermercado emissor:
Identifique nas imagens o logotipo, nome da rede ou dados da filial (rodapé/cabeçalho). Compare com a lista de mercados cadastrados a seguir e retorne o ID correspondente da loja mais compatível. Se não houver correspondência exata, retorne null.

Lista de mercados cadastrados:
${mercadosPromptList}

Regras estritas de extração:
1. Retorne EXCLUSIVAMENTE um JSON válido seguindo exatamente o schema especificado.
2. Em "mercado_sugerido_id", retorne o UUID exato ("id") do mercado mais compatível da lista acima ou null se não houver correspondência confiável. Em "mercado_nome_detectado", informe o nome da rede/loja detectado na imagem (ou null se ilegível).
3. INSPECIONE ATIVAMENTE o cabeçalho, o rodapé, selos, faixas e letras miúdas de todo o encarte em busca de expressões de vigência/validade (ex.: "Ofertas válidas de DD/MM até DD/MM/AAAA", "Válido até DD/MM", "Preços válidos de...", "Promoção válida de ... a ...").
   - Converta a data inicial para "data_inicio_sugerida" e a data final para "data_fim_sugerida" no formato ISO "YYYY-MM-DD".
   - Se o ano for omitido no impresso (ex.: "20/11" ou "de 18/11 a 25/11"), assuma o ano corrente (${currentYear}).
   - Caso não consiga identificar nenhuma data de término no folheto, retorne exatamente "${defaultEndIso}" (5 dias à frente da data atual) em "data_fim_sugerida". Para "data_inicio_sugerida" não encontrada, use "${todayIso}".
4. Para cada oferta:
   - "produto_nome": nome claro do produto sem repetir marca/peso se já estiverem nos campos próprios (ex: "Arroz Branco Tipo 1").
   - "marca": fabricante/marca (ex: "Camil", "Pilão", "OMO"). Se não houver marca (ex: hortifrúti), use "".
   - "peso_volume": embalagem/peso/volume (ex: "5kg", "1L", "500g", "350ml").
   - "categoria": escolha exatamente uma destas opções: "Mercearia", "Laticínios", "Hortifrúti", "Limpeza", "Matinais", "Bebidas" (ou "Higiene", "Açougue", "Padaria", "Outros" apenas se nenhuma das principais se aplicar).
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
      "categoria": "Mercearia | Laticínios | Hortifrúti | Limpeza | Matinais | Bebidas",
      "preco_normal": 0.00,
      "preco_oferta": 0.00,
      "is_clube": false,
      "data_fim": "YYYY-MM-DD"
    }
  ]
}`;

    const parts = [
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: normalizedMime,
        },
      },
    ];

    const generationConfig = {
      responseMimeType: "application/json",
      temperature: 0.1,
    };

    const rawText = await generateWithGeminiFallback(
      genAI,
      parts,
      generationConfig
    );

    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsedJson: unknown = JSON.parse(cleanedJson);
    const payload = sanitizeExtractedPayload(parsedJson, validMercadoIds);

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
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
