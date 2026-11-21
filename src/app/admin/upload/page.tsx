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
  const [saving, setSaving] = useState<boolean>(false);
  const [ofertas, setOfertas] = useState<EditableOffer[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);

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
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-olive/15 px-2.5 py-1 text-xs font-semibold text-brand-olive">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Fase 3 · Ingestão Multimodal com Gemini
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-brand-dark">
            Upload e Conferência de Encartes
          </h1>
          <p className="mt-1 text-sm text-brand-taupe">
            Envie a imagem ou PDF do encarte, extraia as ofertas automaticamente
            com IA e valide os preços antes de publicar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            id="extract-ai-btn"
            type="button"
            onClick={() => void handleExtractWithAI()}
            disabled={extracting || !selectedFile}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold disabled:cursor-not-allowed disabled:opacity-55"
          >
            {extracting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Extraindo com IA...
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
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Salvando...
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

      {/* Configuração do Encarte */}
      <section className="grid gap-4 rounded-2xl border border-brand-taupe bg-white p-5 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="mercado-select"
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-dark"
            >
              <Store className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
              Mercado Emissor
            </label>

            {mercadoDetectionStatus === "matched" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold/60 bg-brand-yellow/25 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                <Sparkles className="h-3 w-3 text-brand-olive" aria-hidden="true" />
                Identificado automaticamente via IA
              </span>
            )}

            {mercadoDetectionStatus === "unmatched" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
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
            className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-medium text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none disabled:opacity-60 ${
              mercadoDetectionStatus === "unmatched"
                ? "border-brand-gold ring-2 ring-brand-yellow/35"
                : "border-brand-taupe"
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
                    {mercado.nome_rede} — {mercado.unidade}
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
              Opcional antes de extrair: a IA tenta identificar o mercado
              automaticamente.
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
            Início da Vigência (data_inicio)
          </label>
          <input
            id="data-inicio-input"
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-full rounded-xl border border-brand-taupe bg-white px-3.5 py-2.5 text-sm font-medium text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-brand-taupe">
            Preenchida automaticamente quando identificada no encarte.
          </p>
        </div>
      </section>

      {/* Área Principal: Preview à esquerda + Tabela de Conferência à direita/abaixo */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Coluna de Upload & Preview */}
        <section className="space-y-4 lg:col-span-4">
          <div className="overflow-hidden rounded-2xl border border-brand-taupe bg-white">
            <div className="flex items-center justify-between bg-brand-dark px-4 py-3 text-white">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                <ImageIcon
                  className="h-4 w-4 text-brand-yellow"
                  aria-hidden="true"
                />
                Arquivo do Encarte
              </span>
              {selectedFile && (
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Limpar
                </button>
              )}
            </div>

            <div className="p-4">
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
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  isDragging
                    ? "border-brand-yellow bg-brand-yellow/15"
                    : "border-brand-taupe/60 bg-[#fcfaf5] hover:border-brand-olive hover:bg-brand-yellow/10"
                }`}
              >
                <UploadCloud
                  className="h-8 w-8 text-brand-olive"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm font-semibold text-brand-dark">
                  Arraste o encarte aqui ou clique para selecionar
                </p>
                <p className="mt-1 text-xs text-brand-taupe">
                  Formatos aceitos: JPG, PNG, WEBP ou PDF (até 20 MB)
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

              {selectedFile && previewUrl && (
                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center justify-between rounded-lg border border-brand-taupe/40 bg-[#faf7ef] px-3 py-2 text-xs">
                    <span className="truncate font-semibold text-brand-dark">
                      {selectedFile.name}
                    </span>
                    <span className="ml-2 shrink-0 rounded bg-brand-olive/20 px-2 py-0.5 font-medium text-brand-dark">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-brand-taupe bg-[#faf7ef]">
                    {isPdf ? (
                      <div className="space-y-2 p-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-brand-dark">
                          <FileText
                            className="h-4 w-4 text-brand-olive"
                            aria-hidden="true"
                          />
                          Pré-visualização PDF
                        </div>
                        <iframe
                          src={previewUrl}
                          title="Pré-visualização do encarte em PDF"
                          className="h-80 w-full rounded-lg border border-brand-taupe/30 bg-white"
                        />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Pré-visualização do encarte enviado"
                        className="max-h-[420px] w-full object-contain"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Coluna da Tabela de Conferência */}
        <section className="lg:col-span-8">
          <div className="overflow-hidden rounded-2xl border border-brand-taupe bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-dark px-5 py-3.5 text-white">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-bold uppercase tracking-wider">
                  Tabela de Conferência
                </h2>
                <span className="rounded-full bg-brand-yellow px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                  {ofertas.length}{" "}
                  {ofertas.length === 1 ? "item" : "itens"}
                </span>
              </div>

              <button
                id="add-manual-row-btn"
                type="button"
                onClick={addManualRow}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-gold bg-brand-olive/30 px-3 py-1.5 text-xs font-semibold text-brand-yellow transition-colors hover:bg-brand-olive/50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />+ Adicionar
                Linha Manual
              </button>
            </div>

            {/* Bloco de Controle de Vigência */}
            <div className="border-b border-brand-taupe bg-brand-yellow/10 px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex-1 max-w-xs">
                  <label
                    htmlFor="data-fim-geral-input"
                    className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-dark"
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
                    className="w-full rounded-xl border border-brand-taupe bg-white px-3.5 py-2 text-sm font-semibold text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                  />
                </div>

                <button
                  id="apply-global-validity-btn"
                  type="button"
                  onClick={applyGlobalValidityToAllItems}
                  disabled={ofertas.length === 0 || !dataFim}
                  className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  Aplicar esta validade a todos os itens
                </button>
              </div>
              <p className="mt-2 text-xs text-brand-taupe">
                Sugerida pela IA ao ler cabeçalho, rodapé e letras miúdas do
                encarte. Edite aqui ou ajuste individualmente na coluna{" "}
                <strong className="text-brand-dark">Validade</strong>.
              </p>
            </div>

            {ofertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-yellow/20 text-brand-dark">
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-bold text-brand-dark">
                  Nenhuma oferta na conferência ainda
                </h3>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-brand-taupe">
                  Selecione um mercado, envie um encarte e clique em{" "}
                  <strong>&ldquo;Extrair Ofertas com IA&rdquo;</strong> ou
                  adicione ofertas manualmente.
                </p>
                <button
                  type="button"
                  onClick={addManualRow}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-brand-taupe bg-white px-4 py-2 text-xs font-bold text-brand-dark transition-colors hover:bg-brand-yellow/15"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />+
                  Adicionar Linha Manual
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-brand-taupe bg-[#faf7ef] font-bold uppercase tracking-wider text-brand-dark">
                      <th className="px-3 py-3">Produto</th>
                      <th className="px-3 py-3">Marca</th>
                      <th className="px-3 py-3">Peso/Vol.</th>
                      <th className="px-3 py-3">Categoria</th>
                      <th className="px-3 py-3">Normal (R$)</th>
                      <th className="px-3 py-3">Oferta (R$)</th>
                      <th className="px-3 py-3 text-center">Clube</th>
                      <th className="px-3 py-3">Validade</th>
                      <th className="px-3 py-3 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-taupe/35">
                    {ofertas.map((row) => {
                      const hasPriceAlert =
                        row.preco_oferta <= 0 ||
                        (row.preco_normal > 0 &&
                          row.preco_oferta > row.preco_normal);

                      return (
                        <tr
                          key={row.localId}
                          className="transition-colors hover:bg-[#fcfaf5]"
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
                              className="w-full min-w-[170px] rounded-lg border border-brand-taupe/70 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-dark focus:border-brand-gold focus:ring-1 focus:ring-brand-yellow focus:outline-none"
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
                              className="w-28 rounded-lg border border-brand-taupe/70 bg-white px-2.5 py-1.5 text-xs text-brand-dark focus:border-brand-gold focus:ring-1 focus:ring-brand-yellow focus:outline-none"
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
                              className="w-20 rounded-lg border border-brand-taupe/70 bg-white px-2 py-1.5 text-xs text-brand-dark focus:border-brand-gold focus:ring-1 focus:ring-brand-yellow focus:outline-none"
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
                              className="w-32 rounded-lg border border-brand-taupe/70 bg-white px-2 py-1.5 text-xs text-brand-dark focus:border-brand-gold focus:ring-1 focus:ring-brand-yellow focus:outline-none"
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
                              className="w-22 rounded-lg border border-brand-taupe/70 bg-white px-2 py-1.5 text-xs text-brand-dark focus:border-brand-gold focus:ring-1 focus:ring-brand-yellow focus:outline-none"
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
                                className={`w-22 rounded-lg border bg-white px-2 py-1.5 text-xs font-bold text-brand-dark focus:ring-1 focus:outline-none ${
                                  hasPriceAlert
                                    ? "border-red-500 focus:border-red-600 focus:ring-red-300"
                                    : "border-brand-taupe/70 focus:border-brand-gold focus:ring-brand-yellow"
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
                              className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                row.is_clube
                                  ? "bg-brand-olive text-white"
                                  : "border border-brand-taupe/50 bg-[#faf7ef] text-brand-taupe"
                              }`}
                            >
                              {row.is_clube && (
                                <Check className="h-3 w-3" aria-hidden="true" />
                              )}
                              {row.is_clube ? "Clube" : "Comum"}
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
                              className={`w-36 rounded-lg border bg-white px-2 py-1.5 text-xs font-medium text-brand-dark focus:ring-1 focus:outline-none ${
                                !row.data_fim
                                  ? "border-red-500 focus:border-red-600 focus:ring-red-300"
                                  : "border-brand-taupe focus:border-brand-gold focus:ring-brand-yellow"
                              }`}
                            />
                          </td>

                          <td className="px-2.5 py-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeOfferRow(row.localId)}
                              title="Remover linha"
                              aria-label={`Remover ${row.produto_nome || "linha"}`}
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-brand-taupe/40 p-1.5 text-brand-taupe transition-colors hover:border-red-400 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
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
