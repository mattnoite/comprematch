"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  Copy,
  Database,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Store,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  OFERTA_CATEGORIAS,
  type ExtractApiResponse,
  type ExtractedOffer,
  type Mercado,
} from "@/types/database";

interface EditableOffer extends ExtractedOffer {
  localId: string;
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultDataFim(): string {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return date.toISOString().slice(0, 10);
}

function createEmptyOffer(defaultDataFim: string): EditableOffer {
  return {
    localId: crypto.randomUUID(),
    produto_nome: "",
    marca: "",
    peso_volume: "",
    categoria: "Mercearia",
    preco_normal: 0,
    preco_oferta: 0,
    is_clube: false,
    data_fim: defaultDataFim,
  };
}

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const EXTRACTION_STAGES = [
  "Lendo layout e validade do encarte...",
  "Identificando rede e unidade do supermercado...",
  "Extraindo produtos, marcas e preços promocionais...",
  "Estruturando itens para conferência...",
] as const;

export default function AdminUploadPage() {
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mercados, setMercados] = useState<Mercado[]>([]);
  const [loadingMercados, setLoadingMercados] = useState<boolean>(true);
  const [mercadoId, setMercadoId] = useState<string>("");
  const [mercadoDetectionStatus, setMercadoDetectionStatus] = useState<
    "idle" | "matched" | "unmatched"
  >("idle");
  const [mercadoNomeDetectado, setMercadoNomeDetectado] = useState<
    string | null
  >(null);
  const [dataInicio, setDataInicio] = useState<string>(getTodayIso);
  const [dataFim, setDataFim] = useState<string>(getDefaultDataFim);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [extracting, setExtracting] = useState<boolean>(false);
  const [extractionStageIdx, setExtractionStageIdx] = useState<number>(0);
  const [saving, setSaving] = useState<boolean>(false);
  const [ofertas, setOfertas] = useState<EditableOffer[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!extracting) return;
    const interval = window.setInterval(() => {
      setExtractionStageIdx((prev) => (prev + 1) % EXTRACTION_STAGES.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [extracting]);

  const showToast = useCallback(
    (type: ToastMessage["type"], title: string, description?: string) => {
      setToast({ id: Date.now(), type, title, description });
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    async function loadMercados() {
      setLoadingMercados(true);
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from("mercados")
          .select("id, nome_rede, unidade, endereco, latitude, longitude, created_at")
          .order("nome_rede", { ascending: true });

        if (!mounted) return;

        if (error) {
          showToast("error", "Erro ao carregar mercados", error.message);
          return;
        }

        const list = (data as Mercado[]) ?? [];
        setMercados(list);
      } catch (err) {
        if (!mounted) return;
        showToast(
          "error",
          "Erro ao buscar mercados",
          err instanceof Error ? err.message : "Falha inesperada."
        );
      } finally {
        if (mounted) setLoadingMercados(false);
      }
    }

    void loadMercados();
    return () => {
      mounted = false;
    };
  }, [showToast]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileSelection = useCallback(
    (file: File | null) => {
      if (!file) return;

      if (!ACCEPTED_TYPES.has(file.type)) {
        showToast(
          "error",
          "Formato de arquivo inválido",
          "Envie uma imagem JPG, PNG ou um arquivo PDF."
        );
        return;
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const objectUrl = URL.createObjectURL(file);
      setSelectedFile(file);
      setPreviewUrl(objectUrl);
    },
    [previewUrl, showToast]
  );

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    handleFileSelection(file);
  }

  function clearSelectedFile() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleExtractWithAI() {
    if (!selectedFile) {
      showToast(
        "error",
        "Nenhum encarte selecionado",
        "Arraste ou selecione uma imagem JPG/PNG ou PDF do encarte."
      );
      return;
    }
    if (!session?.access_token) {
      showToast(
        "error",
        "Sessão expirada",
        "Faça login novamente para usar a extração com IA."
      );
      return;
    }

    setExtractionStageIdx(0);
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (mercadoId) {
        formData.append("mercado_id", mercadoId);
      }

      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const payload = (await response.json()) as Partial<ExtractApiResponse> & {
        error?: string;
      };

      if (!response.ok) {
        showToast(
          "error",
          "Falha na extração com IA",
          payload.error ?? "Não foi possível processar o encarte."
        );
        return;
      }

      const extractedList = Array.isArray(payload.ofertas)
        ? payload.ofertas
        : [];

      const suggestedId =
        typeof payload.mercado_sugerido_id === "string" &&
        payload.mercado_sugerido_id.trim()
          ? payload.mercado_sugerido_id.trim()
          : null;
      const matchedMercado = suggestedId
        ? mercados.find((m) => m.id === suggestedId) ?? null
        : null;

      setMercadoNomeDetectado(payload.mercado_nome_detectado ?? null);
      if (matchedMercado) {
        setMercadoId(matchedMercado.id);
        setMercadoDetectionStatus("matched");
      } else {
        setMercadoId("");
        setMercadoDetectionStatus("unmatched");
      }

      const resolvedDataFim =
        payload.data_fim_sugerida || dataFim || getDefaultDataFim();
      setDataFim(resolvedDataFim);

      if (payload.data_inicio_sugerida) {
        setDataInicio(payload.data_inicio_sugerida);
      }

      if (extractedList.length === 0) {
        showToast(
          "error",
          "Nenhuma oferta identificada",
          "Tente uma imagem mais nítida ou adicione linhas manualmente."
        );
        return;
      }

      setOfertas(
        extractedList.map((item) => ({
          ...item,
          data_fim: item.data_fim || resolvedDataFim,
          localId: crypto.randomUUID(),
        }))
      );

      showToast(
        "success",
        `${extractedList.length} ofertas extraídas`,
        "Revise os campos na tabela antes de salvar no banco."
      );
    } catch (err) {
      showToast(
        "error",
        "Erro na requisição",
        err instanceof Error ? err.message : "Falha ao contatar /api/extract."
      );
    } finally {
      setExtracting(false);
    }
  }

  function updateOfferField<K extends keyof EditableOffer>(
    localId: string,
    field: K,
    value: EditableOffer[K]
  ) {
    setOfertas((prev) =>
      prev.map((row) =>
        row.localId === localId ? { ...row, [field]: value } : row
      )
    );
  }

  function removeOfferRow(localId: string) {
    setOfertas((prev) => prev.filter((row) => row.localId !== localId));
  }

  function duplicateOfferRow(localId: string) {
    setOfertas((prev) => {
      const idx = prev.findIndex((row) => row.localId === localId);
      if (idx === -1) return prev;
      const clone: EditableOffer = {
        ...prev[idx],
        localId: crypto.randomUUID(),
      };
      return [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)];
    });
  }

  function addManualRow() {
    setOfertas((prev) => [
      ...prev,
      createEmptyOffer(dataFim || getDefaultDataFim()),
    ]);
  }

  function handleGlobalDataFimChange(nextDate: string) {
    const previousGlobalDate = dataFim;
    setDataFim(nextDate);
    if (!nextDate) return;
    setOfertas((prev) =>
      prev.map((row) =>
        !row.data_fim || row.data_fim === previousGlobalDate
          ? { ...row, data_fim: nextDate }
          : row
      )
    );
  }

  function applyGlobalValidityToAllItems() {
    if (!dataFim) {
      showToast(
        "error",
        "Informe a validade geral",
        "Defina a Data de Validade Geral do Encarte antes de aplicar aos itens."
      );
      return;
    }

    setOfertas((prev) => prev.map((row) => ({ ...row, data_fim: dataFim })));
    showToast(
      "success",
      "Validade aplicada a todos os itens",
      `Todas as ${ofertas.length} ofertas agora expiram em ${dataFim}.`
    );
  }

  async function handleSaveToDatabase() {
    if (!mercadoId) {
      showToast("error", "Selecione um mercado", "Campo obrigatório.");
      return;
    }
    if (!dataFim) {
      showToast(
        "error",
        "Informe a data de validade",
        "Defina até quando as ofertas estarão vigentes."
      );
      return;
    }

    const validOffers = ofertas.filter(
      (item) => item.produto_nome.trim().length > 0 && item.preco_oferta > 0
    );

    if (validOffers.length === 0) {
      showToast(
        "error",
        "Nenhuma oferta válida para salvar",
        "Adicione ou extraia pelo menos um item com nome e preço promocional maior que zero."
      );
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const todayIso = getTodayIso();
      const resolvedDataInicio =
        dataInicio && dataInicio <= dataFim
          ? dataInicio
          : todayIso <= dataFim
            ? todayIso
            : dataFim;

      let arquivoUrl = `manual://${mercadoId}/${Date.now()}`;
      if (selectedFile) {
        const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${mercadoId}/${Date.now()}-${sanitizedName}`;

        const { error: uploadError } = await supabase.storage
          .from("encartes")
          .upload(storagePath, selectedFile, { upsert: false });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from("encartes")
            .getPublicUrl(storagePath);
          arquivoUrl = publicUrlData.publicUrl;
        } else {
          arquivoUrl = `encarte://${mercadoId}/${Date.now()}-${sanitizedName}`;
        }
      }

      const { data: encarteCriado, error: encarteError } = await supabase
        .from("encartes")
        .insert({
          mercado_id: mercadoId,
          arquivo_url: arquivoUrl,
          data_inicio: resolvedDataInicio,
          data_fim: dataFim,
        })
        .select("id")
        .single();

      if (encarteError || !encarteCriado) {
        showToast(
          "error",
          "Erro ao registrar encarte",
          encarteError?.message ?? "Verifique suas permissões no Supabase."
        );
        return;
      }

      const ofertasPayload = validOffers.map((item) => {
        const precoOferta = Number(item.preco_oferta.toFixed(2));
        const precoNormalRaw = Number(item.preco_normal.toFixed(2));
        const precoNormal =
          precoNormalRaw >= precoOferta ? precoNormalRaw : precoOferta;
        const itemDataFim = item.data_fim?.trim() || dataFim;

        return {
          encarte_id: encarteCriado.id,
          mercado_id: mercadoId,
          produto_nome: item.produto_nome.trim(),
          marca: item.marca.trim() || null,
          peso_volume: item.peso_volume.trim() || null,
          categoria: item.categoria.trim() || "Mercearia",
          preco_normal: precoNormal,
          preco_oferta: precoOferta,
          is_clube: item.is_clube,
          data_fim: itemDataFim,
        };
      });

      const { error: ofertasError } = await supabase
        .from("ofertas")
        .insert(ofertasPayload);

      if (ofertasError) {
        showToast(
          "error",
          "Erro ao salvar ofertas em lote",
          ofertasError.message
        );
        return;
      }

      showToast(
        "success",
        "Ofertas salvas com sucesso!",
        `${ofertasPayload.length} ofertas publicadas para o mercado selecionado.`
      );

      // Limpeza dos campos após publicação
      clearSelectedFile();
      setOfertas([]);
      setMercadoId("");
      setMercadoDetectionStatus("idle");
      setMercadoNomeDetectado(null);
      setDataInicio(getTodayIso());
      setDataFim(getDefaultDataFim());
    } catch (err) {
      showToast(
        "error",
        "Erro inesperado ao salvar",
        err instanceof Error ? err.message : "Tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedMercado = useMemo(
    () => mercados.find((m) => m.id === mercadoId) ?? null,
    [mercados, mercadoId]
  );

  const isPdf = selectedFile?.type === "application/pdf";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-olive/30 bg-brand-olive/10 px-3 py-1 text-xs font-semibold text-brand-olive">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Leitura Inteligente de Encartes
          </span>
          <h1 className="mt-2.5 text-2xl font-black tracking-tight text-brand-dark sm:text-3xl">
            Portal do Lojista / Ingestão de Catálogos
          </h1>
          <p className="mt-1 text-sm text-brand-taupe">
            Faça upload de encartes em imagem ou PDF para extrair ofertas
            automaticamente e publicar na vitrine em segundos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="extract-ai-btn"
            type="button"
            onClick={() => void handleExtractWithAI()}
            disabled={extracting || !selectedFile}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-5 py-2.5 text-sm font-semibold text-brand-dark shadow-xs transition-all hover:bg-brand-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Analisando catálogo...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Extrair Ofertas com IA
              </>
            )}
          </button>

          <button
            id="save-offers-btn"
            type="button"
            onClick={() => void handleSaveToDatabase()}
            disabled={saving || ofertas.length === 0 || !mercadoId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-dark px-5 py-2.5 text-sm font-semibold text-brand-yellow shadow-xs transition-all hover:bg-brand-taupe active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Publicando...
              </>
            ) : (
              <>
                <Database className="h-4 w-4" aria-hidden="true" />
                Salvar Ofertas no Banco
              </>
            )}
          </button>
        </div>
      </div>

      {/* Configuração do Catálogo */}
      <section className="grid gap-5 rounded-2xl border border-stone-200/70 bg-white p-5 shadow-2xs sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="mercado-select"
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-dark"
            >
              <Store className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
              Supermercado Emissor
            </label>

            {mercadoDetectionStatus === "matched" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-yellow/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                <Sparkles className="h-3 w-3 text-brand-olive" aria-hidden="true" />
                Identificado automaticamente via IA
              </span>
            )}

            {mercadoDetectionStatus === "unmatched" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden="true" />
                Selecione o mercado manualmente
              </span>
            )}
          </div>

          <select
            id="mercado-select"
            value={mercadoId}
            onChange={(e) => {
              setMercadoId(e.target.value);
              setMercadoDetectionStatus("idle");
            }}
            disabled={loadingMercados}
            className={`w-full rounded-xl border bg-[#FAFAF9] px-3.5 py-2.5 text-sm font-medium text-brand-dark transition-colors focus:border-brand-olive focus:bg-white focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none disabled:opacity-60 ${
              mercadoDetectionStatus === "unmatched"
                ? "border-brand-gold ring-2 ring-brand-yellow/30"
                : "border-stone-200/90"
            }`}
          >
            {loadingMercados ? (
              <option value="">Carregando mercados...</option>
            ) : mercados.length === 0 ? (
              <option value="">Nenhum mercado cadastrado</option>
            ) : (
              <>
                <option value="">
                  Selecione um mercado (ou deixe a IA identificar)...
                </option>
                {mercados.map((mercado) => (
                  <option key={mercado.id} value={mercado.id}>
                    {mercado.nome_rede} • {mercado.unidade}
                  </option>
                ))}
              </>
            )}
          </select>

          {selectedMercado ? (
            <p className="mt-1.5 text-xs text-brand-taupe">
              {selectedMercado.endereco}
              {mercadoDetectionStatus === "matched" && mercadoNomeDetectado
                ? ` · Detectado na arte: "${mercadoNomeDetectado}"`
                : ""}
            </p>
          ) : mercadoDetectionStatus === "unmatched" ? (
            <p className="mt-1.5 text-xs font-medium text-brand-taupe">
              {mercadoNomeDetectado
                ? `Identificado na arte: "${mercadoNomeDetectado}" (sem correspondência exata). Selecione o mercado manualmente.`
                : "Não foi possível identificar o mercado no encarte. Selecione o mercado manualmente."}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-brand-taupe">
              Opcional antes de extrair: a IA identifica automaticamente a rede
              e a filial a partir do catálogo.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="data-inicio-input"
            className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-dark"
          >
            <Calendar
              className="h-3.5 w-3.5 text-brand-olive"
              aria-hidden="true"
            />
            Início da Vigência
          </label>
          <input
            id="data-inicio-input"
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-full rounded-xl border border-stone-200/90 bg-[#FAFAF9] px-3.5 py-2.5 text-sm font-medium text-brand-dark transition-colors focus:border-brand-olive focus:bg-white focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-brand-taupe">
            Capturada automaticamente quando presente no cabeçalho ou rodapé do
            encarte.
          </p>
        </div>
      </section>

      {/* Área Principal: Preview à esquerda + Tabela de Conferência à direita/abaixo */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Coluna de Upload & Preview (Estilo Stripe / Vercel) */}
        <section className="space-y-4 lg:col-span-4">
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-2xs">
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-dark">
                <ImageIcon
                  className="h-4 w-4 text-brand-olive"
                  aria-hidden="true"
                />
                Upload de Catálogo
              </span>
              {selectedFile && (
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-taupe transition-colors hover:bg-stone-100 hover:text-brand-dark"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Remover
                </button>
              )}
            </div>

            <div className="p-5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-all ${
                  isDragging
                    ? "border-brand-yellow bg-brand-yellow/10"
                    : "border-stone-300/90 bg-[#FAFAF9] hover:border-brand-olive hover:bg-brand-yellow/5"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-200/80 bg-white text-brand-olive shadow-2xs transition-transform group-hover:scale-105">
                  <UploadCloud className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="mt-3.5 text-sm font-bold text-brand-dark">
                  Arraste o encarte ou clique para enviar
                </p>
                <p className="mt-1 text-xs text-brand-taupe">
                  JPG, PNG, WEBP ou PDF • até 20 MB
                </p>

                <input
                  ref={fileInputRef}
                  id="flyer-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) =>
                    handleFileSelection(e.target.files?.[0] ?? null)
                  }
                  className="sr-only"
                />
              </div>

              {/* Barra de Progresso Animada durante a Leitura da IA */}
              {extracting && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-4 space-y-2.5 rounded-2xl border border-brand-gold/40 bg-brand-yellow/10 p-4"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-brand-dark">
                      <Sparkles
                        className="h-3.5 w-3.5 text-brand-olive"
                        aria-hidden="true"
                      />
                      Processamento IA em andamento
                    </span>
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin text-brand-gold"
                      aria-hidden="true"
                    />
                  </div>
                  <progress
                    className="brand-progress block w-full"
                    aria-label="Extraindo ofertas do encarte com inteligência artificial"
                  />
                  <p className="text-[11px] font-medium text-brand-taupe">
                    {EXTRACTION_STAGES[extractionStageIdx]}
                  </p>
                </div>
              )}

              {selectedFile && previewUrl && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-stone-200/80 bg-[#FAFAF9] px-3.5 py-2.5 text-xs">
                    <span className="truncate font-semibold text-brand-dark">
                      {selectedFile.name}
                    </span>
                    <span className="ml-2 shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-brand-taupe ring-1 ring-stone-200/80">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-[#FAFAF9]">
                    {isPdf ? (
                      <div className="space-y-2 p-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-brand-dark">
                          <FileText
                            className="h-4 w-4 text-brand-olive"
                            aria-hidden="true"
                          />
                          Pré-visualização do catálogo (PDF)
                        </div>
                        <iframe
                          src={previewUrl}
                          title="Pré-visualização do catálogo em PDF"
                          className="h-80 w-full rounded-xl border border-stone-200/70 bg-white"
                        />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Pré-visualização do catálogo enviado"
                        className="max-h-[420px] w-full object-contain"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Coluna da Tabela de Conferência Limpa */}
        <section className="lg:col-span-8">
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-extrabold tracking-tight text-brand-dark">
                  Conferência de Ofertas
                </h2>
                <span className="rounded-full bg-brand-yellow/25 px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                  {ofertas.length}{" "}
                  {ofertas.length === 1 ? "item" : "itens"}
                </span>
              </div>

              <button
                id="add-manual-row-btn"
                type="button"
                onClick={addManualRow}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-brand-olive/45 bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark transition-all hover:border-brand-gold hover:bg-brand-yellow/15 active:scale-95"
              >
                <Plus className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
                + Adicionar Linha Manual
              </button>
            </div>

            {/* Bloco de Controle de Vigência */}
            <div className="border-b border-stone-200/70 bg-[#FAFAF9] px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-xs flex-1">
                  <label
                    htmlFor="data-fim-geral-input"
                    className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-dark"
                  >
                    <Calendar
                      className="h-3.5 w-3.5 text-brand-olive"
                      aria-hidden="true"
                    />
                    Data de Validade Geral do Encarte
                  </label>
                  <input
                    id="data-fim-geral-input"
                    type="date"
                    value={dataFim}
                    onChange={(e) => handleGlobalDataFimChange(e.target.value)}
                    className="w-full rounded-xl border border-stone-200/90 bg-white px-3.5 py-2 text-sm font-semibold text-brand-dark transition-colors focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                  />
                </div>

                <button
                  id="apply-global-validity-btn"
                  type="button"
                  onClick={applyGlobalValidityToAllItems}
                  disabled={ofertas.length === 0 || !dataFim}
                  className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-semibold text-brand-dark shadow-xs transition-all hover:bg-brand-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  Aplicar esta validade a todos os itens
                </button>
              </div>
              <p className="mt-2 text-xs text-brand-taupe">
                Preenchida automaticamente pela leitura do catálogo. Edite aqui
                ou ajuste prazos específicos na coluna{" "}
                <strong className="text-brand-dark">Validade</strong>.
              </p>
            </div>

            {ofertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow/20 text-brand-dark">
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-bold text-brand-dark">
                  Nenhuma oferta em conferência
                </h3>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-brand-taupe">
                  Envie um catálogo ao lado e clique em{" "}
                  <strong>&ldquo;Extrair Ofertas com IA&rdquo;</strong> ou
                  adicione itens manualmente.
                </p>
                <button
                  type="button"
                  onClick={addManualRow}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200/90 bg-white px-4 py-2 text-xs font-semibold text-brand-dark transition-all hover:border-brand-olive hover:bg-brand-yellow/10 active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />+
                  Adicionar Linha Manual
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200/80 bg-[#FAFAF9] text-[11px] font-bold uppercase tracking-wider text-brand-taupe">
                      <th scope="col" className="px-3 py-3">Produto</th>
                      <th scope="col" className="px-3 py-3">Marca</th>
                      <th scope="col" className="px-3 py-3">Peso/Vol.</th>
                      <th scope="col" className="px-3 py-3">Categoria</th>
                      <th scope="col" className="px-3 py-3">Normal (R$)</th>
                      <th scope="col" className="px-3 py-3">Oferta (R$)</th>
                      <th scope="col" className="px-3 py-3 text-center">Fidelidade</th>
                      <th scope="col" className="px-3 py-3">Validade</th>
                      <th scope="col" className="px-3 py-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {ofertas.map((row) => {
                      const hasPriceAlert =
                        row.preco_oferta <= 0 ||
                        (row.preco_normal > 0 &&
                          row.preco_oferta > row.preco_normal);

                      return (
                        <tr
                          key={row.localId}
                          className="transition-colors hover:bg-[#FAFAF9]/80"
                        >
                          <td className="px-2.5 py-2.5">
                            <input
                              type="text"
                              value={row.produto_nome}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "produto_nome",
                                  e.target.value
                                )
                              }
                              placeholder="Ex: Arroz Branco Tipo 1"
                              className="w-full min-w-[170px] rounded-xl border border-stone-200/90 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-dark focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2.5">
                            <input
                              type="text"
                              value={row.marca}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "marca",
                                  e.target.value
                                )
                              }
                              placeholder="Marca"
                              className="w-28 rounded-xl border border-stone-200/90 bg-white px-2.5 py-1.5 text-xs text-brand-dark focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2.5">
                            <input
                              type="text"
                              value={row.peso_volume}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "peso_volume",
                                  e.target.value
                                )
                              }
                              placeholder="5kg"
                              className="w-20 rounded-xl border border-stone-200/90 bg-white px-2.5 py-1.5 text-xs text-brand-dark focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2.5">
                            <select
                              value={row.categoria}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "categoria",
                                  e.target.value
                                )
                              }
                              className="w-32 rounded-xl border border-stone-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-dark focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                            >
                              {OFERTA_CATEGORIAS.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-2.5 py-2.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.preco_normal}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "preco_normal",
                                  Number.parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-22 rounded-xl border border-stone-200/90 bg-white px-2.5 py-1.5 text-xs text-brand-taupe focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={row.preco_oferta}
                                onChange={(e) =>
                                  updateOfferField(
                                    row.localId,
                                    "preco_oferta",
                                    Number.parseFloat(e.target.value) || 0
                                  )
                                }
                                className={`w-22 rounded-xl border bg-white px-2.5 py-1.5 text-xs font-bold text-brand-dark focus:ring-2 focus:outline-none ${
                                  hasPriceAlert
                                    ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                                    : "border-stone-200/90 focus:border-brand-olive focus:ring-brand-yellow/35"
                                }`}
                              />
                              {hasPriceAlert && (
                                <span title="Confira o preço promocional">
                                  <AlertTriangle
                                    className="h-3.5 w-3.5 text-red-600"
                                    aria-hidden="true"
                                  />
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-2.5 py-2.5 text-center">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={row.is_clube}
                              onClick={() =>
                                updateOfferField(
                                  row.localId,
                                  "is_clube",
                                  !row.is_clube
                                )
                              }
                              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-95 ${
                                row.is_clube
                                  ? "border-brand-gold bg-brand-yellow/20 text-brand-dark"
                                  : "border-stone-200/90 bg-[#FAFAF9] text-brand-taupe hover:border-brand-olive"
                              }`}
                            >
                              {row.is_clube && (
                                <Check className="h-3 w-3 text-brand-olive" aria-hidden="true" />
                              )}
                              {row.is_clube ? "Preço Clube" : "Regular"}
                            </button>
                          </td>

                          <td className="px-2.5 py-2.5">
                            <input
                              type="date"
                              value={row.data_fim}
                              onChange={(e) =>
                                updateOfferField(
                                  row.localId,
                                  "data_fim",
                                  e.target.value
                                )
                              }
                              aria-label={`Validade de ${row.produto_nome || "oferta"}`}
                              className={`w-36 rounded-xl border bg-white px-2.5 py-1.5 text-xs font-medium text-brand-dark focus:ring-2 focus:outline-none ${
                                !row.data_fim
                                  ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                                  : "border-stone-200/90 focus:border-brand-olive focus:ring-brand-yellow/35"
                              }`}
                            />
                          </td>

                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => duplicateOfferRow(row.localId)}
                                title="Duplicar linha"
                                aria-label={`Duplicar ${row.produto_nome || "linha"}`}
                                className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-stone-200/80 p-1.5 text-brand-taupe transition-colors hover:border-brand-olive hover:bg-brand-yellow/15 hover:text-brand-dark"
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeOfferRow(row.localId)}
                                title="Remover linha"
                                aria-label={`Remover ${row.produto_nome || "linha"}`}
                                className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-stone-200/80 p-1.5 text-brand-taupe transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
