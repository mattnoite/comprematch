import { NextResponse, type NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
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

function normalizeDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return getDefaultEndDate();
}

function sanitizeExtractedPayload(raw: unknown): ExtractApiResponse {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawOffers = Array.isArray(obj.ofertas) ? obj.ofertas : [];

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
      };
    })
    .filter((item) => item.produto_nome.length > 0);

  return {
    data_fim_sugerida: normalizeDate(obj.data_fim_sugerida),
    ofertas,
  };
}

async function authorizeStaffRequest(request: NextRequest): Promise<{
  ok: boolean;
  status: number;
  error?: string;
}> {
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

  return { ok: true, status: 200 };
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
    const mercadoId = formData.get("mercado_id");

    if (!mercadoId || typeof mercadoId !== "string" || !mercadoId.trim()) {
      return NextResponse.json(
        { error: "Selecione o mercado emissor antes de extrair." },
        { status: 400 }
      );
    }

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString("base64");

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const todayIso = new Date().toISOString().slice(0, 10);

    const prompt = `Você é um especialista em OCR e estruturação de encartes de supermercados brasileiros para o aplicativo CompreMatch.
Analise cuidadosamente a imagem/PDF deste encarte promocional (mercado_id: ${mercadoId}) e extraia TODAS as ofertas visíveis.

Data atual de referência: ${todayIso}.

Regras estritas de extração:
1. Retorne EXCLUSIVAMENTE um JSON válido seguindo exatamente o schema especificado.
2. Em "data_fim_sugerida", informe a data final da promoção encontrada no encarte no formato "YYYY-MM-DD". Caso não esteja visível no encarte, sugira a data atual + 5 dias.
3. Para cada oferta:
   - "produto_nome": nome claro do produto sem repetir marca/peso se já estiverem nos campos próprios (ex: "Arroz Branco Tipo 1").
   - "marca": fabricante/marca (ex: "Camil", "Pilão", "OMO"). Se não houver marca (ex: hortifrúti), use "".
   - "peso_volume": embalagem/peso/volume (ex: "5kg", "1L", "500g", "350ml").
   - "categoria": escolha exatamente uma destas opções: "Mercearia", "Laticínios", "Hortifrúti", "Limpeza", "Matinais", "Bebidas" (ou "Higiene", "Açougue", "Padaria", "Outros" apenas se nenhuma das principais se aplicar).
   - "preco_normal": preço de referência ("De:") como número decimal. Se apenas o preço promocional estiver visível, repita o valor de preco_oferta.
   - "preco_oferta": preço promocional ("Por:") como número decimal.
   - "is_clube": true se a oferta exigir aplicativo/clube de fidelidade do mercado (ex: "Clube", "App", "Meu Carrefour", "Cliente Mais"), caso contrário false.

Schema JSON esperado:
{
  "data_fim_sugerida": "YYYY-MM-DD",
  "ofertas": [
    {
      "produto_nome": "Nome do Produto",
      "marca": "Marca",
      "peso_volume": "ex: 5kg, 1L, 500g",
      "categoria": "Mercearia | Laticínios | Hortifrúti | Limpeza | Matinais | Bebidas",
      "preco_normal": 0.00,
      "preco_oferta": 0.00,
      "is_clube": false
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

    let rawText = "";
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig,
      });
      const result = await model.generateContent(parts);
      rawText = result.response.text();
    } catch (primaryErr) {
      console.warn(
        "Falha com gemini-2.0-flash, tentando fallback gemini-1.5-flash:",
        primaryErr
      );
      const fallbackModel = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig,
      });
      const fallbackResult = await fallbackModel.generateContent(parts);
      rawText = fallbackResult.response.text();
    }

    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsedJson: unknown = JSON.parse(cleanedJson);
    const payload = sanitizeExtractedPayload(parsedJson);

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
