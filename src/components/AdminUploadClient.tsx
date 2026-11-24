"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  Copy,
  Database,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Store,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { getSupabaseClient } from "@/lib/supabase/client";
import { CATEGORY_MAP, resolveCategoryKey } from "@/lib/categoryAssets";
import { groupMercadosByChain } from "@/lib/chains";
import { getSaoPauloOffsetIso, getSaoPauloTodayIso } from "@/lib/date";
import {
  OFERTA_CATEGORIAS,
  type ExtractApiResponse,
  type ExtractQuotaStatus,
  type ExtractedOffer,
  type Mercado,
} from "@/types/database";

interface EditableOffer extends ExtractedOffer {
  localId: string;
}

type IngestionMode = "ai" | "manual";

interface ManualDraft {
  produto_nome: string;
  marca: string;
  peso_volume: string;
  categoria: string;
  preco_normal: string;
  preco_oferta: string;
  is_clube: boolean;
  data_fim: string;
}

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

function getTodayIso(): string {
  return getSaoPauloTodayIso();
}

function getDefaultDataFim(): string {
  return getSaoPauloOffsetIso(5);
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatIsoDateBR(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function parsePriceInput(raw: string): number {
  const cleaned = raw.replace(",", ".").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function createInitialDraft(defaultDataFim: string): ManualDraft {
  return {
    produto_nome: "",
    marca: "",
    peso_volume: "",
    categoria: "mercearia",
    preco_normal: "",
    preco_oferta: "",
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

const QUOTA_STORAGE_KEY = "comprematch:extract-quota-v1";

function readStoredQuota(): ExtractQuotaStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(QUOTA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExtractQuotaStatus;
    if (!parsed || typeof parsed !== "object" || !parsed.exhausted) {
      window.localStorage.removeItem(QUOTA_STORAGE_KEY);
      return null;
    }
    if (parsed.resetAtIso) {
      const resetMs = Date.parse(parsed.resetAtIso);
      if (Number.isFinite(resetMs) && Date.now() >= resetMs) {
        window.localStorage.removeItem(QUOTA_STORAGE_KEY);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredQuota(quota: ExtractQuotaStatus | null) {
  if (typeof window === "undefined") return;
  try {
    if (quota && quota.exhausted) {
      window.localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
    } else {
      window.localStorage.removeItem(QUOTA_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function requestLiveQuotaStatus(
  accessToken: string | undefined
): Promise<ExtractQuotaStatus | null> {
  const stored = readStoredQuota();
  if (!accessToken) {
    return stored;
  }

  try {
    const res = await fetch("/api/extract", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      return stored;
    }
    const data = (await res.json()) as { quota?: ExtractQuotaStatus };
    if (data.quota?.exhausted) {
      saveStoredQuota(data.quota);
      return data.quota;
    }
    if (stored && stored.exhausted) {
      // Mantém aviso local se ainda estiver dentro da janela de reset (ex.: cold start serverless)
      return stored;
    }
    return data.quota ?? null;
  } catch {
    return stored;
  }
}

const VERCEL_SAFE_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB (margem segura abaixo dos 4,5 MB da Vercel)
const CLIENT_EXTRACT_TIMEOUT_MS = 65_000;

async function splitPdfIntoPageFiles(file: File): Promise<File[]> {
  if (file.type !== "application/pdf" || typeof window === "undefined") {
    return [file];
  }

  try {
    const { PDFDocument } = await import("pdf-lib");
    const buffer = await file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pageCount = sourcePdf.getPageCount();
    if (pageCount <= 1) {
      return [file];
    }

    const baseName = file.name.replace(/\.pdf$/i, "");
    const pageFiles: File[] = [];
    for (let i = 0; i < pageCount; i++) {
      const singleDoc = await PDFDocument.create();
      const [copiedPage] = await singleDoc.copyPages(sourcePdf, [i]);
      singleDoc.addPage(copiedPage);
      const bytes = await singleDoc.save();
      pageFiles.push(
        new File([new Uint8Array(bytes)], `${baseName}-pagina-${i + 1}.pdf`, {
          type: "application/pdf",
          lastModified: Date.now(),
        })
      );
    }

    return pageFiles;
  } catch {
    return [file];
  }
}

async function compressImageForExtraction(file: File): Promise<File> {
  if (file.type === "application/pdf" || typeof window === "undefined") {
    return file;
  }

  // Imagens pequenas já estão abaixo da margem de segurança e não precisam reencodar
  if (file.size <= 1.8 * 1024 * 1024) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Falha ao carregar imagem para compressão."));
      el.src = objectUrl;
    });

    const presets = [
      { maxDim: 2048, quality: 0.85 },
      { maxDim: 1600, quality: 0.74 },
    ] as const;

    let bestFile = file;

    for (const preset of presets) {
      const scale = Math.min(
        1,
        preset.maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1)
      );
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", preset.quality)
      );
      if (!blob) continue;

      if (blob.size < bestFile.size) {
        const baseName = file.name.replace(/\.[^.]+$/, "");
        bestFile = new File([blob], `${baseName}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }

      if (bestFile.size <= 3.5 * 1024 * 1024) {
        break;
      }
    }

    return bestFile;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const EXTRACTION_STAGES = [
  "Lendo layout e validade do encarte...",
  "Identificando rede do supermercado...",
  "Extraindo produtos, marcas e preços promocionais...",
  "Estruturando itens para conferência...",
] as const;

export default function AdminUploadPage() {
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualNameInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<IngestionMode>("ai");
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

  const [manualDraft, setManualDraft] = useState<ManualDraft>(() =>
    createInitialDraft(getDefaultDataFim())
  );
  const [manualError, setManualError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState<boolean>(false);
  const [extractionStageIdx, setExtractionStageIdx] = useState<number>(0);
  const [pageProgress, setPageProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [quotaStatus, setQuotaStatus] = useState<ExtractQuotaStatus | null>(null);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [saving, setSaving] = useState<boolean>(false);
  const [ofertas, setOfertas] = useState<EditableOffer[]>([]);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [editPriceDraft, setEditPriceDraft] = useState<{
    normal: string;
    oferta: string;
  }>({ normal: "", oferta: "" });
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const accessToken = session?.access_token;

  useEffect(() => {
    if (!extracting) return;
    const interval = window.setInterval(() => {
      setExtractionStageIdx((prev) => (prev + 1) % EXTRACTION_STAGES.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [extracting]);

  useEffect(() => {
    let active = true;
    void requestLiveQuotaStatus(accessToken).then((resolved) => {
      if (!active || !resolved) return;
      setNowMs(Date.now());
      setQuotaStatus(resolved);
    });
    return () => {
      active = false;
    };
  }, [accessToken]);

  const minuteResetMs =
    quotaStatus?.exhausted &&
    quotaStatus.kind === "minute" &&
    quotaStatus.resetAtIso
      ? Date.parse(quotaStatus.resetAtIso)
      : NaN;

  const cooldownRemainingSec = Number.isFinite(minuteResetMs)
    ? Math.max(0, Math.ceil((minuteResetMs - nowMs) / 1000))
    : 0;

  useEffect(() => {
    if (!Number.isFinite(minuteResetMs)) return;

    let active = true;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= minuteResetMs) {
        window.clearInterval(timer);
        saveStoredQuota(null);
        void requestLiveQuotaStatus(accessToken).then((resolved) => {
          if (!active) return;
          setQuotaStatus(resolved);
        });
      }
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [minuteResetMs, accessToken]);

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
          .select(
            "id, nome_rede, unidade, endereco, latitude, longitude, created_at"
          )
          .order("nome_rede", { ascending: true });

        if (!mounted) return;

        if (error) {
          showToast("error", "Erro ao carregar redes", error.message);
          return;
        }

        const list = (data as Mercado[]) ?? [];
        setMercados(list);
      } catch (err) {
        if (!mounted) return;
        showToast(
          "error",
          "Erro ao buscar redes",
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
          "Envie uma imagem JPG, PNG, WEBP ou um arquivo PDF."
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
    setPageProgress(null);
    setExtracting(true);
    try {
      const filesToProcess =
        selectedFile.type === "application/pdf"
          ? await splitPdfIntoPageFiles(selectedFile)
          : [await compressImageForExtraction(selectedFile)];

      const totalPages = filesToProcess.length;
      const accumulatedOffers: EditableOffer[] = [];
      let detectedSuggestedId: string | null = null;
      let detectedMercadoNome: string | null = null;
      let detectedDataFim: string | null = null;
      let detectedDataInicio: string | null = null;

      for (let i = 0; i < totalPages; i++) {
        setPageProgress({ current: i + 1, total: totalPages });

        const formData = new FormData();
        formData.append("file", filesToProcess[i]);
        if (mercadoId) {
          formData.append("mercado_id", mercadoId);
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          CLIENT_EXTRACT_TIMEOUT_MS
        );

        let response: Response;
        try {
          response = await fetch("/api/extract", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            body: formData,
            signal: controller.signal,
          });
        } catch (fetchErr) {
          if (accumulatedOffers.length > 0) {
            setOfertas(accumulatedOffers);
          }
          if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
            showToast(
              "error",
              totalPages > 1
                ? `Tempo esgotado na página ${i + 1} de ${totalPages}`
                : "Tempo limite excedido na extração",
              accumulatedOffers.length > 0
                ? `${accumulatedOffers.length} ofertas das páginas anteriores foram mantidas na lista.`
                : "A resposta demorou demais. Tente um arquivo menor ou com menos itens por página."
            );
            return;
          }
          throw fetchErr;
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (response.status === 413) {
          if (accumulatedOffers.length > 0) {
            setOfertas(accumulatedOffers);
          }
          showToast(
            "error",
            "Arquivo grande demais para envio",
            "A página excede o limite de 4,5 MB da Vercel. Envie como imagem (JPG/PNG) para compressão automática."
          );
          return;
        }

        if (response.status === 504) {
          if (accumulatedOffers.length > 0) {
            setOfertas(accumulatedOffers);
          }
          showToast(
            "error",
            totalPages > 1
              ? `Timeout na página ${i + 1} de ${totalPages}`
              : "Servidor demorou para responder (504)",
            accumulatedOffers.length > 0
              ? `${accumulatedOffers.length} ofertas das páginas anteriores foram mantidas na lista.`
              : "Tente enviar o encarte como imagem ou PDF menor."
          );
          return;
        }

        const payload = (await response
          .json()
          .catch(() => ({}))) as Partial<ExtractApiResponse> & {
          error?: string;
          code?: string;
        };

        if (!response.ok) {
          if (accumulatedOffers.length > 0) {
            setOfertas(accumulatedOffers);
          }

          const isQuotaExhausted =
            response.status === 429 ||
            response.status === 402 ||
            payload.code === "CREDITS_EXHAUSTED" ||
            payload.code === "QUOTA_EXHAUSTED" ||
            payload.code === "RATE_LIMITED" ||
            Boolean(payload.quota?.exhausted);

          if (isQuotaExhausted) {
            const fallbackKind =
              payload.code === "RATE_LIMITED" ? "minute" : "credits";
            const nextQuota: ExtractQuotaStatus = payload.quota ?? {
              exhausted: true,
              kind: fallbackKind,
              retryAfterSeconds: fallbackKind === "minute" ? 60 : null,
              resetAtIso:
                fallbackKind === "minute"
                  ? new Date(Date.now() + 60 * 1000).toISOString()
                  : null,
            };
            setNowMs(Date.now());
            setQuotaStatus(nextQuota);
            saveStoredQuota(nextQuota);
            showToast(
              "error",
              nextQuota.kind === "minute"
                ? "Limite por minuto atingido"
                : "Saldo da API do Claude esgotado",
              payload.error ??
                "Veja o aviso na seção de extração para mais detalhes."
            );
            return;
          }

          showToast(
            "error",
            totalPages > 1
              ? `Falha na página ${i + 1} de ${totalPages}`
              : "Falha na extração com IA",
            payload.error ?? "Não foi possível processar o encarte."
          );
          return;
        }

        saveStoredQuota(null);
        setQuotaStatus(payload.quota ?? null);
        if (payload.model_label || payload.model_used) {
          setLastModelUsed(payload.model_label ?? payload.model_used ?? null);
        }

        if (!detectedSuggestedId && typeof payload.mercado_sugerido_id === "string" && payload.mercado_sugerido_id.trim()) {
          detectedSuggestedId = payload.mercado_sugerido_id.trim();
        }
        if (!detectedMercadoNome && payload.mercado_nome_detectado) {
          detectedMercadoNome = payload.mercado_nome_detectado;
        }
        if (!detectedDataFim && payload.data_fim_sugerida) {
          detectedDataFim = payload.data_fim_sugerida;
        }
        if (!detectedDataInicio && payload.data_inicio_sugerida) {
          detectedDataInicio = payload.data_inicio_sugerida;
        }

        const pageOffers = Array.isArray(payload.ofertas) ? payload.ofertas : [];
        const pageEndFallback =
          payload.data_fim_sugerida ||
          detectedDataFim ||
          dataFim ||
          getDefaultDataFim();

        for (const item of pageOffers) {
          accumulatedOffers.push({
            ...item,
            data_fim: item.data_fim || pageEndFallback,
            localId: crypto.randomUUID(),
          });
        }
      }

      const currentChains = groupMercadosByChain(mercados);
      const matchedChain = detectedSuggestedId
        ? currentChains.find(
            (c) =>
              c.representativeId === detectedSuggestedId ||
              c.branches.some((b) => b.id === detectedSuggestedId)
          ) ?? null
        : null;

      setMercadoNomeDetectado(detectedMercadoNome);
      if (matchedChain) {
        setMercadoId(matchedChain.representativeId);
        setMercadoDetectionStatus("matched");
      } else if (!mercadoId) {
        setMercadoId("");
        setMercadoDetectionStatus("unmatched");
      }

      const resolvedDataFim =
        detectedDataFim || dataFim || getDefaultDataFim();
      setDataFim(resolvedDataFim);
      setManualDraft((prev) => ({ ...prev, data_fim: resolvedDataFim }));

      if (detectedDataInicio) {
        setDataInicio(detectedDataInicio);
      }

      if (accumulatedOffers.length === 0) {
        showToast(
          "error",
          "Nenhuma oferta identificada",
          "Tente uma imagem mais nítida ou use a aba Cadastro Manual."
        );
        return;
      }

      setOfertas(accumulatedOffers);
      setEditingLocalId(null);

      showToast(
        "success",
        `${accumulatedOffers.length} ofertas extraídas`,
        totalPages > 1
          ? `${totalPages} páginas processadas. Confira a lista abaixo e clique em Publicar Ofertas.`
          : "Confira a lista abaixo e clique em Publicar Ofertas."
      );
    } catch (err) {
      showToast(
        "error",
        "Erro na requisição",
        err instanceof Error ? err.message : "Falha ao contatar /api/extract."
      );
    } finally {
      setExtracting(false);
      setPageProgress(null);
    }
  }

  function handleAddManualOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nome = manualDraft.produto_nome.trim();
    const precoOferta = parsePriceInput(manualDraft.preco_oferta);
    const precoNormalParsed = parsePriceInput(manualDraft.preco_normal);

    if (!nome) {
      setManualError("Informe o nome do produto.");
      manualNameInputRef.current?.focus();
      return;
    }

    if (precoOferta <= 0) {
      setManualError("Informe um preço promocional maior que zero.");
      return;
    }

    if (precoNormalParsed > 0 && precoOferta > precoNormalParsed) {
      setManualError(
        "O preço promocional não pode ser maior que o preço normal."
      );
      return;
    }

    const precoNormal =
      precoNormalParsed >= precoOferta ? precoNormalParsed : precoOferta;
    const resolvedFim = manualDraft.data_fim || dataFim || getDefaultDataFim();

    const newOffer: EditableOffer = {
      localId: crypto.randomUUID(),
      produto_nome: nome,
      marca: manualDraft.marca.trim(),
      peso_volume: manualDraft.peso_volume.trim(),
      categoria: resolveCategoryKey(manualDraft.categoria),
      preco_normal: precoNormal,
      preco_oferta: precoOferta,
      is_clube: manualDraft.is_clube,
      data_fim: resolvedFim,
    };

    setOfertas((prev) => [newOffer, ...prev]);
    setManualError(null);
    setManualDraft((prev) => ({
      ...createInitialDraft(resolvedFim),
      categoria: prev.categoria,
    }));

    showToast(
      "success",
      "Oferta adicionada à lista",
      `${nome} · ${formatBRL(precoOferta)}`
    );

    window.setTimeout(() => {
      manualNameInputRef.current?.focus();
    }, 0);
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
    if (editingLocalId === localId) {
      setEditingLocalId(null);
    }
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

  function handleGlobalDataFimChange(nextDate: string) {
    const previousGlobalDate = dataFim;
    setDataFim(nextDate);
    if (!nextDate) return;

    setManualDraft((prev) =>
      !prev.data_fim || prev.data_fim === previousGlobalDate
        ? { ...prev, data_fim: nextDate }
        : prev
    );

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
        "Defina a data de validade do encarte antes de aplicar aos itens."
      );
      return;
    }

    setOfertas((prev) => prev.map((row) => ({ ...row, data_fim: dataFim })));
    setManualDraft((prev) => ({ ...prev, data_fim: dataFim }));
    showToast(
      "success",
      "Validade aplicada a todos os itens",
      `Todas as ${ofertas.length} ofertas agora valem até ${formatIsoDateBR(dataFim)}.`
    );
  }

  async function handleSaveToDatabase() {
    if (!mercadoId) {
      showToast(
        "error",
        "Selecione a rede de supermercado",
        "Escolha no Passo 1 a rede emissora antes de publicar."
      );
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
        "Nenhuma oferta válida para publicar",
        "Adicione pelo menos um item com nome e preço promocional maior que zero."
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
        const precoOferta = Number(item.preco_oferta);
        const precoNormal =
          Number(item.preco_normal) >= precoOferta
            ? Number(item.preco_normal)
            : precoOferta;
        const itemDataFim =
          item.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(item.data_fim)
            ? item.data_fim
            : dataFim;

        return {
          encarte_id: encarteCriado.id,
          mercado_id: mercadoId,
          produto_nome: item.produto_nome.trim(),
          marca: item.marca.trim() || null,
          peso_volume: item.peso_volume.trim() || null,
          categoria: resolveCategoryKey(item.categoria),
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
        // Evita registro órfão na tabela encartes caso o lote de ofertas falhe
        await supabase.from("encartes").delete().eq("id", encarteCriado.id);
        showToast(
          "error",
          "Erro ao salvar ofertas em lote",
          ofertasError.message
        );
        return;
      }

      showToast(
        "success",
        "Ofertas publicadas com sucesso!",
        `${ofertasPayload.length} ofertas já estão disponíveis na vitrine.`
      );

      clearSelectedFile();
      setOfertas([]);
      setEditingLocalId(null);
      setMercadoId("");
      setMercadoDetectionStatus("idle");
      setMercadoNomeDetectado(null);
      const nextToday = getTodayIso();
      const nextEnd = getDefaultDataFim();
      setDataInicio(nextToday);
      setDataFim(nextEnd);
      setManualDraft(createInitialDraft(nextEnd));
    } catch (err) {
      showToast(
        "error",
        "Erro inesperado ao publicar",
        err instanceof Error ? err.message : "Tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }

  const chainGroups = useMemo(() => groupMercadosByChain(mercados), [mercados]);

  const selectedChain = useMemo(
    () =>
      chainGroups.find(
        (c) =>
          c.representativeId === mercadoId ||
          c.branches.some((b) => b.id === mercadoId)
      ) ?? null,
    [chainGroups, mercadoId]
  );

  const validOffersCount = useMemo(
    () =>
      ofertas.filter(
        (item) => item.produto_nome.trim().length > 0 && item.preco_oferta > 0
      ).length,
    [ofertas]
  );

  const alertsCount = useMemo(
    () =>
      ofertas.filter(
        (row) =>
          !row.produto_nome.trim() ||
          row.preco_oferta <= 0 ||
          (row.preco_normal > 0 && row.preco_oferta > row.preco_normal) ||
          !row.data_fim
      ).length,
    [ofertas]
  );

  const draftNormalNum = parsePriceInput(manualDraft.preco_normal);
  const draftOfertaNum = parsePriceInput(manualDraft.preco_oferta);
  const draftDiscountPct =
    draftNormalNum > 0 && draftOfertaNum > 0 && draftNormalNum > draftOfertaNum
      ? Math.round(((draftNormalNum - draftOfertaNum) / draftNormalNum) * 100)
      : 0;

  const canPublish = !saving && validOffersCount > 0 && Boolean(mercadoId);
  const publishHint = !mercadoId
    ? "Selecione a rede no Passo 1"
    : validOffersCount === 0
      ? "Adicione ao menos 1 oferta abaixo"
      : null;

  const isPdf = selectedFile?.type === "application/pdf";

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-olive/30 bg-brand-olive/10 px-3 py-1 text-[11px] font-semibold text-brand-olive">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Portal do Lojista · Grande São Paulo
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-brand-dark">
            Ingestão de Catálogos
          </h1>
          <p className="mt-1 text-sm text-brand-taupe">
            Publique ofertas extraindo de um encarte com IA ou cadastrando itens
            manualmente.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <button
            id="save-offers-btn"
            type="button"
            onClick={() => void handleSaveToDatabase()}
            disabled={!canPublish}
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-dark px-5 py-2.5 text-sm font-bold text-brand-yellow transition-all hover:bg-[#23211c] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#333029]/30 disabled:text-white/80"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Publicando…
              </>
            ) : (
              <>
                <Database className="h-4 w-4" aria-hidden="true" />
                Publicar Ofertas
                {validOffersCount > 0 && (
                  <span
                    className={`rounded-full bg-brand-yellow px-2 py-0.5 text-[11px] font-black text-brand-dark ${NUM}`}
                  >
                    {validOffersCount}
                  </span>
                )}
              </>
            )}
          </button>
          {publishHint && (
            <span className="text-[11px] text-brand-taupe">{publishHint}</span>
          )}
        </div>
      </div>

      {/* PASSO 1: Dados do Encarte (Rede + Início + Validade juntos) */}
      <section
        aria-labelledby="step-1-heading"
        className="rounded-2xl border border-[#333029]/10 bg-white p-5"
      >
        <div className="mb-4 flex items-center gap-2.5">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-dark text-xs font-black text-brand-yellow ${NUM}`}
          >
            1
          </span>
          <h2
            id="step-1-heading"
            className="text-sm font-bold tracking-tight text-brand-dark"
          >
            Dados do Encarte
          </h2>
          {mercadoDetectionStatus === "matched" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-yellow/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
              <Sparkles
                className="h-3 w-3 text-brand-olive"
                aria-hidden="true"
              />
              Rede identificada pela IA
            </span>
          )}
          {mercadoDetectionStatus === "unmatched" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
              <AlertTriangle
                className="h-3 w-3 text-amber-600"
                aria-hidden="true"
              />
              Selecione a rede manualmente
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-12">
          <div className="md:col-span-6">
            <label
              htmlFor="mercado-select"
              className={`mb-1.5 flex items-center gap-1.5 ${MICRO_LABEL}`}
            >
              <Store
                className="h-3.5 w-3.5 text-brand-olive"
                aria-hidden="true"
              />
              Rede de Supermercado *
            </label>

            <select
              id="mercado-select"
              value={mercadoId}
              onChange={(e) => {
                setMercadoId(e.target.value);
                setMercadoDetectionStatus("idle");
              }}
              disabled={loadingMercados}
              className={`w-full rounded-xl border bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-medium text-brand-dark transition-colors focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none disabled:opacity-60 ${
                mercadoDetectionStatus === "unmatched"
                  ? "border-brand-gold ring-2 ring-brand-yellow/30"
                  : "border-[#333029]/15"
              }`}
            >
              {loadingMercados ? (
                <option value="">Carregando redes...</option>
              ) : chainGroups.length === 0 ? (
                <option value="">Nenhuma rede cadastrada</option>
              ) : (
                <>
                  <option value="">
                    {mode === "ai"
                      ? "Selecione a rede (ou deixe a IA identificar)..."
                      : "Selecione a rede de supermercado..."}
                  </option>
                  {chainGroups.map((chain) => (
                    <option key={chain.key} value={chain.representativeId}>
                      {chain.nome_rede}
                    </option>
                  ))}
                </>
              )}
            </select>

            {selectedChain ? (
              <p className="mt-1.5 text-xs text-brand-taupe">
                Válido para toda a Grande São Paulo ({selectedChain.branches.length}{" "}
                {selectedChain.branches.length === 1
                  ? "filial mapeada"
                  : "filiais mapeadas"}
                )
                {mercadoDetectionStatus === "matched" && mercadoNomeDetectado
                  ? ` · Detectado: "${mercadoNomeDetectado}"`
                  : ""}
              </p>
            ) : mercadoDetectionStatus === "unmatched" ? (
              <p className="mt-1.5 text-xs font-medium text-brand-taupe">
                {mercadoNomeDetectado
                  ? `Detectado na arte: "${mercadoNomeDetectado}" (sem correspondência exata). Selecione acima.`
                  : "Não foi possível identificar a rede na imagem. Selecione acima."}
              </p>
            ) : null}
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="data-inicio-input"
              className={`mb-1.5 flex items-center gap-1.5 ${MICRO_LABEL}`}
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
              className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-medium text-brand-dark transition-colors focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="data-fim-geral-input"
              className={`mb-1.5 flex items-center gap-1.5 ${MICRO_LABEL}`}
            >
              <Calendar
                className="h-3.5 w-3.5 text-brand-olive"
                aria-hidden="true"
              />
              Validade Geral *
            </label>
            <input
              id="data-fim-geral-input"
              type="date"
              value={dataFim}
              onChange={(e) => handleGlobalDataFimChange(e.target.value)}
              className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-medium text-brand-dark transition-colors focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
            />
            {ofertas.length > 0 && (
              <button
                id="apply-global-validity-btn"
                type="button"
                onClick={applyGlobalValidityToAllItems}
                className="mt-1.5 cursor-pointer text-[11px] font-semibold text-brand-olive underline underline-offset-2 hover:text-brand-dark"
              >
                Aplicar validade a todos os {ofertas.length} itens
              </button>
            )}
          </div>
        </div>
      </section>

      {/* PASSO 2: Escolha do modo de entrada (Abas claras) */}
      <section
        aria-labelledby="step-2-heading"
        className="overflow-hidden rounded-2xl border border-[#333029]/10 bg-white"
      >
        <div className="flex flex-col gap-3 border-b border-[#333029]/10 bg-[#F8F7F4]/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-dark text-xs font-black text-brand-yellow ${NUM}`}
            >
              2
            </span>
            <h2
              id="step-2-heading"
              className="text-sm font-bold tracking-tight text-brand-dark"
            >
              Adicionar Ofertas
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Modo de ingestão de ofertas"
            className="inline-grid grid-cols-2 rounded-xl border border-[#333029]/10 bg-[#EDEAE3] p-1"
          >
            <button
              id="tab-ai-mode"
              type="button"
              role="tab"
              aria-selected={mode === "ai"}
              aria-controls="panel-ai-mode"
              onClick={() => setMode("ai")}
              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                mode === "ai"
                  ? "bg-white text-brand-dark shadow-xs"
                  : "text-brand-taupe hover:text-brand-dark"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
              Leitura de Encarte (IA)
            </button>

            <button
              id="tab-manual-mode"
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              aria-controls="panel-manual-mode"
              onClick={() => {
                setMode("manual");
                window.setTimeout(() => {
                  manualNameInputRef.current?.focus();
                }, 0);
              }}
              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                mode === "manual"
                  ? "bg-white text-brand-dark shadow-xs"
                  : "text-brand-taupe hover:text-brand-dark"
              }`}
            >
              <PencilLine className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
              Cadastro Manual
            </button>
          </div>
        </div>

        {/* Painel 1: Leitura com IA */}
        {mode === "ai" && (
          <div
            id="panel-ai-mode"
            role="tabpanel"
            aria-labelledby="tab-ai-mode"
            className="p-5"
          >
            {quotaStatus?.exhausted && (
              <div
                id="ai-quota-exhausted-banner"
                role="alert"
                className={`mb-5 rounded-2xl border p-4 text-brand-dark ${
                  quotaStatus.kind === "credits"
                    ? "border-amber-400/70 bg-amber-50/90"
                    : "border-brand-gold/60 bg-brand-yellow/15"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        quotaStatus.kind === "credits"
                          ? "bg-amber-200/70 text-amber-950"
                          : "bg-brand-yellow/40 text-brand-dark"
                      }`}
                    >
                      {quotaStatus.kind === "credits" ? (
                        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <Clock className="h-5 w-5" aria-hidden="true" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                            quotaStatus.kind === "credits"
                              ? "bg-amber-200/80 text-amber-950"
                              : "bg-brand-dark text-brand-yellow"
                          }`}
                        >
                          {quotaStatus.kind === "credits"
                            ? "Créditos da API esgotados"
                            : "Limite temporário por minuto"}
                        </span>
                      </div>

                      <h3 className="font-serif text-lg font-semibold tracking-tight text-brand-dark">
                        {quotaStatus.kind === "credits"
                          ? "Saldo insuficiente na API do Claude"
                          : `Pausa curta na extração por IA${
                              cooldownRemainingSec > 0
                                ? ` · aguarde ${cooldownRemainingSec}s`
                                : ""
                            }`}
                      </h3>

                      <p className="text-xs leading-relaxed text-brand-dark/80">
                        {quotaStatus.kind === "credits" ? (
                          <>
                            Os créditos da sua conta Anthropic para o{" "}
                            <strong className="text-brand-dark">
                              Claude Haiku 5.5
                            </strong>{" "}
                            acabaram ou atingiram o limite de gasto configurado em{" "}
                            <strong className="text-brand-dark">
                              platform.claude.com
                            </strong>
                            . Enquanto recarrega, você pode continuar
                            cadastrando ofertas normalmente pela aba{" "}
                            <strong className="text-brand-dark">
                              Cadastro Manual
                            </strong>
                            .
                          </>
                        ) : (
                          <>
                            O Claude Haiku atingiu o limite temporário de
                            requisições por minuto. Aguarde alguns segundos para
                            extrair novamente.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-2 sm:pl-12">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("manual");
                      window.setTimeout(() => {
                        manualNameInputRef.current?.focus();
                      }, 0);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#333029] px-3.5 py-2 text-xs font-bold text-brand-yellow transition-colors hover:bg-[#333029]/90"
                  >
                    <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                    Ir para Cadastro Manual
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      saveStoredQuota(null);
                      setQuotaStatus(null);
                      void requestLiveQuotaStatus(accessToken).then(
                        (resolved) => {
                          setNowMs(Date.now());
                          setQuotaStatus(resolved);
                        }
                      );
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#333029]/20 bg-white px-3.5 py-2 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Verificar disponibilidade novamente
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-6">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-9 text-center transition-all ${
                    isDragging
                      ? "border-brand-yellow bg-brand-yellow/10"
                      : "border-[#333029]/20 bg-[#F8F7F4] hover:border-brand-gold hover:bg-brand-yellow/5"
                  }`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand-olive ring-1 ring-[#333029]/10">
                    <UploadCloud className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-brand-dark">
                    {selectedFile
                      ? "Clique ou arraste para trocar o arquivo"
                      : "Arraste o encarte ou clique para enviar"}
                  </p>
                  <p className="mt-1 text-xs text-brand-taupe">
                    JPG, PNG, WEBP ou PDF · até 20 MB
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

                {selectedFile && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-[#333029]/10 bg-[#F8F7F4] px-3.5 py-2.5 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      {isPdf ? (
                        <FileText
                          className="h-4 w-4 shrink-0 text-brand-olive"
                          aria-hidden="true"
                        />
                      ) : (
                        <ImageIcon
                          className="h-4 w-4 shrink-0 text-brand-olive"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate font-semibold text-brand-dark">
                        {selectedFile.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-taupe ring-1 ring-[#333029]/10 ${NUM}`}
                      >
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      <button
                        type="button"
                        onClick={clearSelectedFile}
                        aria-label="Remover arquivo selecionado"
                        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-brand-taupe hover:bg-white hover:text-brand-dark"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

                {selectedFile && isPdf && selectedFile.size > VERCEL_SAFE_PAYLOAD_BYTES && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-xl border border-brand-gold/40 bg-brand-yellow/10 px-3.5 py-2.5 text-xs text-brand-dark"
                  >
                    <FileText
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-olive"
                      aria-hidden="true"
                    />
                    <span>
                      Este PDF tem{" "}
                      <strong>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong>.
                      PDFs com múltiplas páginas são divididos e lidos página a
                      página automaticamente para evitar timeouts.
                    </span>
                  </div>
                )}

                <button
                  id="extract-ai-btn"
                  type="button"
                  onClick={() => void handleExtractWithAI()}
                  disabled={
                    extracting ||
                    !selectedFile ||
                    (quotaStatus?.exhausted &&
                      quotaStatus.kind === "minute" &&
                      cooldownRemainingSec > 0)
                  }
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-5 py-3 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {extracting ? (
                    <>
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      {pageProgress && pageProgress.total > 1
                        ? `Extraindo página ${pageProgress.current} de ${pageProgress.total}…`
                        : "Analisando catálogo…"}
                    </>
                  ) : quotaStatus?.exhausted &&
                    quotaStatus.kind === "minute" &&
                    cooldownRemainingSec > 0 ? (
                    <>
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      Aguarde {cooldownRemainingSec}s para extrair novamente
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Extrair Ofertas com IA
                    </>
                  )}
                </button>

                {!extracting && (!quotaStatus || !quotaStatus.exhausted) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#333029]/10 bg-[#F8F7F4] px-3.5 py-2 text-[11px] text-brand-taupe">
                    <span className="inline-flex items-center gap-1.5 font-medium text-brand-dark">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full bg-emerald-600"
                      />
                      Motor IA: {lastModelUsed ?? "Claude Haiku 5.5"}
                    </span>
                    <span className="font-semibold text-brand-taupe">
                      Modelo econômico ativo
                    </span>
                  </div>
                )}

                {extracting && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="space-y-2 rounded-xl border border-brand-gold/40 bg-brand-yellow/10 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-brand-dark">
                        {pageProgress && pageProgress.total > 1
                          ? `Processando página ${pageProgress.current} de ${pageProgress.total}`
                          : "Processamento IA em andamento"}
                      </span>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-brand-gold"
                        aria-hidden="true"
                      />
                    </div>
                    <progress
                      value={
                        pageProgress && pageProgress.total > 1
                          ? pageProgress.current
                          : undefined
                      }
                      max={
                        pageProgress && pageProgress.total > 1
                          ? pageProgress.total
                          : undefined
                      }
                      className="brand-progress block w-full"
                      aria-label="Extraindo ofertas do encarte com inteligência artificial"
                    />
                    <p className="text-[11px] font-medium text-brand-taupe">
                      {pageProgress && pageProgress.total > 1
                        ? `Extraindo ofertas da página ${pageProgress.current} de ${pageProgress.total}…`
                        : EXTRACTION_STAGES[extractionStageIdx]}
                    </p>
                  </div>
                )}
              </div>

              {/* Pré-visualização ou instruções rápidas */}
              <div className="lg:col-span-6">
                {selectedFile && previewUrl ? (
                  <div className="h-full overflow-hidden rounded-2xl border border-[#333029]/10 bg-[#F3F1EC]">
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
                          className="h-64 w-full rounded-xl border border-[#333029]/10 bg-white"
                        />
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Pré-visualização do catálogo enviado"
                        className="max-h-72 w-full object-contain p-2"
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex h-full flex-col justify-center rounded-2xl border border-[#333029]/10 bg-[#F8F7F4]/70 p-5">
                    <p className={MICRO_LABEL}>Como funciona a leitura IA</p>
                    <ol className="mt-3 space-y-2.5 text-xs text-brand-dark">
                      <li className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-brand-olive ring-1 ring-[#333029]/10 ${NUM}`}
                        >
                          1
                        </span>
                        <span>
                          Envie uma foto nítida ou PDF do encarte promocional.
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-brand-olive ring-1 ring-[#333029]/10 ${NUM}`}
                        >
                          2
                        </span>
                        <span>
                          A IA identifica automaticamente a rede, a validade e
                          todos os produtos com preço.
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-brand-olive ring-1 ring-[#333029]/10 ${NUM}`}
                        >
                          3
                        </span>
                        <span>
                          Revise os itens na lista abaixo e clique em{" "}
                          <strong>Publicar Ofertas</strong>.
                        </span>
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Painel 2: Cadastro Manual Dedicado */}
        {mode === "manual" && (
          <form
            id="panel-manual-mode"
            role="tabpanel"
            aria-labelledby="tab-manual-mode"
            onSubmit={handleAddManualOffer}
            className="space-y-4 p-5"
          >
            <div className="grid gap-4 md:grid-cols-12">
              <div className="md:col-span-6">
                <label
                  htmlFor="manual-produto-nome"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Nome do Produto *
                </label>
                <input
                  ref={manualNameInputRef}
                  id="manual-produto-nome"
                  type="text"
                  value={manualDraft.produto_nome}
                  onChange={(e) => {
                    setManualDraft((prev) => ({
                      ...prev,
                      produto_nome: e.target.value,
                    }));
                    if (manualError) setManualError(null);
                  }}
                  placeholder="Ex: Arroz Branco Tipo 1"
                  className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-medium text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="manual-marca"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Marca
                </label>
                <input
                  id="manual-marca"
                  type="text"
                  value={manualDraft.marca}
                  onChange={(e) =>
                    setManualDraft((prev) => ({
                      ...prev,
                      marca: e.target.value,
                    }))
                  }
                  placeholder="Ex: Camil"
                  className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="manual-peso"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Peso / Volume
                </label>
                <input
                  id="manual-peso"
                  type="text"
                  value={manualDraft.peso_volume}
                  onChange={(e) =>
                    setManualDraft((prev) => ({
                      ...prev,
                      peso_volume: e.target.value,
                    }))
                  }
                  placeholder="Ex: 5kg, 1L, 500g"
                  className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-12">
              <div className="md:col-span-4">
                <label
                  htmlFor="manual-categoria"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Categoria
                </label>
                <select
                  id="manual-categoria"
                  value={manualDraft.categoria}
                  onChange={(e) =>
                    setManualDraft((prev) => ({
                      ...prev,
                      categoria: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-medium text-brand-dark focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                >
                  {OFERTA_CATEGORIAS.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_MAP[cat]?.label ?? cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label
                  htmlFor="manual-preco-normal"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Preço Normal — De (R$)
                </label>
                <input
                  id="manual-preco-normal"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={manualDraft.preco_normal}
                  onChange={(e) => {
                    setManualDraft((prev) => ({
                      ...prev,
                      preco_normal: e.target.value,
                    }));
                    if (manualError) setManualError(null);
                  }}
                  placeholder="Opcional"
                  className={`w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none ${NUM}`}
                />
              </div>

              <div className="md:col-span-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label htmlFor="manual-preco-oferta" className={MICRO_LABEL}>
                    Preço Oferta — Por (R$) *
                  </label>
                  {draftDiscountPct > 0 && (
                    <span
                      className={`rounded-md bg-brand-dark px-1.5 py-0.5 text-[10px] font-bold text-brand-yellow ${NUM}`}
                    >
                      -{draftDiscountPct}%
                    </span>
                  )}
                </div>
                <input
                  id="manual-preco-oferta"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={manualDraft.preco_oferta}
                  onChange={(e) => {
                    setManualDraft((prev) => ({
                      ...prev,
                      preco_oferta: e.target.value,
                    }));
                    if (manualError) setManualError(null);
                  }}
                  placeholder="0,00"
                  className={`w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-bold text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none ${NUM}`}
                />
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="manual-validade"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
                >
                  Validade
                </label>
                <input
                  id="manual-validade"
                  type="date"
                  value={manualDraft.data_fim}
                  onChange={(e) =>
                    setManualDraft((prev) => ({
                      ...prev,
                      data_fim: e.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#333029]/15 bg-[#F8F7F4] px-2.5 py-2.5 text-xs font-medium text-brand-dark focus:border-brand-gold focus:bg-white focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>
            </div>

            {manualError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{manualError}</span>
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-[#333029]/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                role="switch"
                aria-checked={manualDraft.is_clube}
                onClick={() =>
                  setManualDraft((prev) => ({
                    ...prev,
                    is_clube: !prev.is_clube,
                  }))
                }
                className={`inline-flex cursor-pointer items-center gap-2 self-start rounded-full border px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${
                  manualDraft.is_clube
                    ? "border-brand-gold bg-brand-yellow/20 text-brand-dark"
                    : "border-[#333029]/15 bg-[#F8F7F4] text-brand-taupe hover:border-brand-gold"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    manualDraft.is_clube
                      ? "border-brand-dark bg-brand-dark text-brand-yellow"
                      : "border-[#333029]/25 bg-white"
                  }`}
                >
                  {manualDraft.is_clube && (
                    <Check className="h-2.5 w-2.5" aria-hidden="true" />
                  )}
                </span>
                Exige Clube / App de fidelidade
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setManualDraft(
                      createInitialDraft(dataFim || getDefaultDataFim())
                    );
                    setManualError(null);
                  }}
                  className="cursor-pointer rounded-xl border border-[#333029]/15 bg-white px-4 py-2.5 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-gold hover:text-brand-dark"
                >
                  Limpar
                </button>
                <button
                  id="add-manual-offer-btn"
                  type="submit"
                  className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brand-yellow px-5 py-2.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98] sm:flex-initial"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Adicionar à Lista
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      {/* PASSO 3: Lista de Ofertas Prontas para Publicar */}
      <section
        aria-labelledby="step-3-heading"
        className="overflow-hidden rounded-2xl border border-[#333029]/10 bg-white"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#333029]/10 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-dark text-xs font-black text-brand-yellow ${NUM}`}
            >
              3
            </span>
            <h2
              id="step-3-heading"
              className="text-sm font-bold tracking-tight text-brand-dark"
            >
              Ofertas na Lista
            </h2>
            <span
              className={`rounded-md bg-[#EDEAE3] px-2.5 py-0.5 text-xs font-bold text-brand-dark ${NUM}`}
            >
              {ofertas.length} {ofertas.length === 1 ? "item" : "itens"}
            </span>
            {alertsCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {alertsCount}{" "}
                {alertsCount === 1 ? "item precisa de revisão" : "itens precisam de revisão"}
              </span>
            )}
          </div>

          {ofertas.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setOfertas([]);
                setEditingLocalId(null);
              }}
              className="cursor-pointer text-xs font-semibold text-brand-taupe underline underline-offset-4 hover:text-red-700"
            >
              Limpar lista
            </button>
          )}
        </div>

        {ofertas.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F3F1EC] text-brand-olive">
              <Tag className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-bold text-brand-dark">
              Sua lista de ofertas está vazia
            </p>
            <p className="mt-1 max-w-md text-xs text-brand-taupe">
              {mode === "ai"
                ? 'Envie um encarte acima e clique em "Extrair Ofertas com IA", ou alterne para a aba Cadastro Manual.'
                : 'Preencha o formulário acima e clique em "Adicionar à Lista" para montar seu catálogo.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#333029]/10">
            {ofertas.map((row) => {
              const isEditing = editingLocalId === row.localId;
              const catKey = resolveCategoryKey(row.categoria);
              const catLabel = CATEGORY_MAP[catKey]?.label ?? row.categoria;
              const hasPriceAlert =
                row.preco_oferta <= 0 ||
                (row.preco_normal > 0 && row.preco_oferta > row.preco_normal);
              const hasAnyAlert =
                !row.produto_nome.trim() || hasPriceAlert || !row.data_fim;
              const discountPct =
                row.preco_normal > row.preco_oferta && row.preco_normal > 0
                  ? Math.round(
                      ((row.preco_normal - row.preco_oferta) /
                        row.preco_normal) *
                        100
                    )
                  : 0;

              if (isEditing) {
                return (
                  <div
                    key={row.localId}
                    className="space-y-3 bg-[#F8F7F4] p-4 sm:p-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={MICRO_LABEL}>Editando oferta</span>
                      <button
                        type="button"
                        onClick={() => setEditingLocalId(null)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-bold text-brand-yellow hover:bg-[#23211c]"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Concluir
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Produto *
                        </label>
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
                          className="w-full rounded-lg border border-[#333029]/15 bg-white px-3 py-2 text-xs font-semibold text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Marca
                        </label>
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
                          className="w-full rounded-lg border border-[#333029]/15 bg-white px-3 py-2 text-xs text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Peso / Vol.
                        </label>
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
                          className="w-full rounded-lg border border-[#333029]/15 bg-white px-3 py-2 text-xs text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Categoria
                        </label>
                        <select
                          value={catKey}
                          onChange={(e) =>
                            updateOfferField(
                              row.localId,
                              "categoria",
                              e.target.value
                            )
                          }
                          className="w-full rounded-lg border border-[#333029]/15 bg-white px-2.5 py-2 text-xs font-medium text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                        >
                          {OFERTA_CATEGORIAS.map((cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_MAP[cat]?.label ?? cat}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          De (R$)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={editPriceDraft.normal}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEditPriceDraft((prev) => ({
                              ...prev,
                              normal: raw,
                            }));
                            updateOfferField(
                              row.localId,
                              "preco_normal",
                              parsePriceInput(raw)
                            );
                          }}
                          className={`w-full rounded-lg border border-[#333029]/15 bg-white px-2.5 py-2 text-xs text-brand-taupe focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none ${NUM}`}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Por (R$) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={editPriceDraft.oferta}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEditPriceDraft((prev) => ({
                              ...prev,
                              oferta: raw,
                            }));
                            updateOfferField(
                              row.localId,
                              "preco_oferta",
                              parsePriceInput(raw)
                            );
                          }}
                          className={`w-full rounded-lg border bg-white px-2.5 py-2 text-xs font-bold text-brand-dark focus:ring-2 focus:outline-none ${NUM} ${
                            hasPriceAlert
                              ? "border-red-400 focus:border-red-500 focus:ring-red-200"
                              : "border-[#333029]/15 focus:border-brand-gold focus:ring-brand-yellow/30"
                          }`}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={`mb-1 block ${MICRO_LABEL}`}>
                          Validade
                        </label>
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
                          className="w-full rounded-lg border border-[#333029]/15 bg-white px-2 py-2 text-xs text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-end sm:col-span-2">
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
                          className={`inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-all ${
                            row.is_clube
                              ? "border-brand-gold bg-brand-yellow/20 text-brand-dark"
                              : "border-[#333029]/15 bg-white text-brand-taupe"
                          }`}
                        >
                          {row.is_clube ? "Preço Clube" : "Regular"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={row.localId}
                  className={`flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-[#F8F7F4]/60 sm:flex-row sm:items-center sm:justify-between ${
                    hasAnyAlert ? "bg-red-50/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-brand-dark">
                        {row.produto_nome || "Produto sem nome"}
                      </p>
                      {(row.marca || row.peso_volume) && (
                        <span className="text-xs text-brand-taupe">
                          {[row.marca, row.peso_volume]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {row.is_clube && (
                        <span className="rounded-full border border-brand-gold bg-brand-yellow/20 px-2 py-0.5 text-[10px] font-bold text-brand-dark">
                          Clube
                        </span>
                      )}
                      {hasAnyAlert && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          <AlertTriangle
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          Revisar
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-brand-taupe">
                      <span className="rounded-md bg-[#F3F1EC] px-2 py-0.5 font-medium text-brand-dark">
                        {catLabel}
                      </span>
                      <span>
                        Válido até{" "}
                        <strong className={`text-brand-dark ${NUM}`}>
                          {row.data_fim ? formatIsoDateBR(row.data_fim) : "—"}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="flex items-baseline gap-2">
                      {row.preco_normal > row.preco_oferta && (
                        <span
                          className={`text-xs text-brand-taupe line-through ${NUM}`}
                        >
                          {formatBRL(row.preco_normal)}
                        </span>
                      )}
                      <span
                        className={`text-base font-black text-brand-dark ${NUM}`}
                      >
                        {formatBRL(row.preco_oferta)}
                      </span>
                      {discountPct > 0 && (
                        <span
                          className={`rounded-md bg-brand-dark px-1.5 py-0.5 text-[10px] font-bold text-brand-yellow ${NUM}`}
                        >
                          -{discountPct}%
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLocalId(row.localId);
                          setEditPriceDraft({
                            normal:
                              row.preco_normal > 0
                                ? String(row.preco_normal)
                                : "",
                            oferta:
                              row.preco_oferta > 0
                                ? String(row.preco_oferta)
                                : "",
                          });
                        }}
                        title="Editar oferta"
                        aria-label={`Editar ${row.produto_nome || "oferta"}`}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/15 bg-white text-brand-taupe transition-colors hover:border-brand-gold hover:text-brand-dark"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateOfferRow(row.localId)}
                        title="Duplicar oferta"
                        aria-label={`Duplicar ${row.produto_nome || "oferta"}`}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/15 bg-white text-brand-taupe transition-colors hover:border-brand-gold hover:text-brand-dark"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOfferRow(row.localId)}
                        title="Remover oferta"
                        aria-label={`Remover ${row.produto_nome || "oferta"}`}
                        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/15 bg-white text-brand-taupe transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Rodapé de confirmação quando há ofertas */}
        {ofertas.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-[#333029]/10 bg-[#F8F7F4] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-brand-taupe">
              <strong className={`text-brand-dark ${NUM}`}>
                {validOffersCount}
              </strong>{" "}
              {validOffersCount === 1 ? "oferta pronta" : "ofertas prontas"}
              {selectedChain
                ? ` para ${selectedChain.nome_rede} (Grande SP)`
                : " · selecione a rede no Passo 1 para publicar"}
            </p>
            <button
              type="button"
              onClick={() => void handleSaveToDatabase()}
              disabled={!canPublish}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Publicando…
                </>
              ) : (
                <>
                  <Database className="h-4 w-4" aria-hidden="true" />
                  Publicar {validOffersCount}{" "}
                  {validOffersCount === 1 ? "Oferta" : "Ofertas"} na Vitrine
                </>
              )}
            </button>
          </div>
        )}
      </section>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
