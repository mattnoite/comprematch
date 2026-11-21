"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  LogIn,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tag,
  X,
} from "lucide-react";
import { CartDrawer } from "@/components/CartDrawer";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Mercado, Oferta } from "@/types/database";

const BASE_CATEGORIES = [
  "Todos",
  "Mercearia",
  "Laticínios",
  "Limpeza",
  "Hortifrúti",
  "Matinais",
  "Bebidas",
] as const;

const QUICK_SEARCH_TAGS = ["Café", "Azeite", "Detergente"] as const;

const REGION_PRESETS = [
  "São Paulo, SP • Vila Mariana",
  "São Paulo, SP • Moema",
  "São Paulo, SP • Paraíso",
  "São Paulo, SP • Ipiranga",
  "São Paulo, SP • Pinheiros",
] as const;

interface MercadoJoin {
  id: string;
  nome_rede: string;
  unidade: string;
  endereco: string;
  latitude: number;
  longitude: number;
}

interface OfertaWithMercado extends Oferta {
  mercado: MercadoJoin;
}

interface RawOfertaRow extends Oferta {
  mercados?: MercadoJoin | MercadoJoin[] | null;
}

function getLocalTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatValidityShort(dataFimIso: string): {
  label: string;
  isUrgent: boolean;
} {
  const match = dataFimIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return { label: "Oferta ativa", isUrgent: false };
  }

  const endYear = Number(match[1]);
  const endMonth = Number(match[2]);
  const endDay = Number(match[3]);

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);
  const diffDays = Math.round((endUtc - todayUtc) / 86_400_000);

  const dd = match[3];
  const mm = match[2];

  if (diffDays <= 0) {
    return { label: "Válido até hoje", isUrgent: true };
  }

  return {
    label: `Válido até ${dd}/${mm}`,
    isUrgent: diffDays <= 1,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getDiscountPercent(normal: number, oferta: number): number | null {
  if (normal <= oferta || normal <= 0) return null;
  const pct = Math.round(((normal - oferta) / normal) * 100);
  return pct >= 2 ? pct : null;
}

export default function VitrinePublicaPage() {
  const { isAuthorizedStaff, loading: authLoading } = useAuth();
  const { items: cartItems, addItem, getItemCount } = useCart();

  const [ofertas, setOfertas] = useState<OfertaWithMercado[]>([]);
  const [mercados, setMercados] = useState<MercadoJoin[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [regionLabel, setRegionLabel] = useState<string>(REGION_PRESETS[0]);
  const [regionMenuOpen, setRegionMenuOpen] = useState<boolean>(false);
  const [customRegionInput, setCustomRegionInput] = useState<string>("");
  const regionMenuRef = useRef<HTMLDivElement | null>(null);

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [selectedMercadoId, setSelectedMercadoId] = useState<string>("todos");

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const drawerId = "smart-basket-drawer";
  const cartCount = getItemCount();

  const showToast = useCallback(
    (type: ToastMessage["type"], title: string, description?: string) => {
      setToast({ id: Date.now(), type, title, description });
    },
    []
  );

  useEffect(() => {
    if (!regionMenuOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        regionMenuRef.current &&
        event.target instanceof Node &&
        !regionMenuRef.current.contains(event.target)
      ) {
        setRegionMenuOpen(false);
      }
    }

    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRegionMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [regionMenuOpen]);

  useEffect(() => {
    let mounted = true;

    async function loadVitrine() {
      if (!isSupabaseConfigured()) {
        if (mounted) {
          setErrorMessage(
            "Serviço de catálogo temporariamente indisponível. Tente novamente em instantes."
          );
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setErrorMessage(null);

      try {
        const supabase = getSupabaseClient();
        const todayIso = getLocalTodayIso();

        const [ofertasRes, mercadosRes] = await Promise.all([
          supabase
            .from("ofertas")
            .select(
              "id, encarte_id, mercado_id, produto_nome, marca, peso_volume, categoria, preco_normal, preco_oferta, is_clube, data_fim, created_at, mercados (id, nome_rede, unidade, endereco, latitude, longitude)"
            )
            .gte("data_fim", todayIso)
            .order("data_fim", { ascending: true })
            .order("preco_oferta", { ascending: true }),
          supabase
            .from("mercados")
            .select("id, nome_rede, unidade, endereco, latitude, longitude")
            .order("nome_rede", { ascending: true }),
        ]);

        if (!mounted) return;

        if (ofertasRes.error) {
          setErrorMessage(
            `Não foi possível carregar as ofertas: ${ofertasRes.error.message}`
          );
          return;
        }

        const mercadosList = ((mercadosRes.data as Mercado[]) ?? []).map(
          (m) => ({
            id: m.id,
            nome_rede: m.nome_rede,
            unidade: m.unidade,
            endereco: m.endereco,
            latitude: Number(m.latitude),
            longitude: Number(m.longitude),
          })
        );
        const mercadoById = new Map(mercadosList.map((m) => [m.id, m]));

        const normalizedOffers: OfertaWithMercado[] = (
          (ofertasRes.data as RawOfertaRow[]) ?? []
        ).flatMap((row) => {
          const joined = Array.isArray(row.mercados)
            ? row.mercados[0]
            : row.mercados;
          const resolvedMercado = joined ?? mercadoById.get(row.mercado_id);
          if (!resolvedMercado) return [];

          return [
            {
              id: row.id,
              encarte_id: row.encarte_id,
              mercado_id: row.mercado_id,
              produto_nome: row.produto_nome,
              marca: row.marca,
              peso_volume: row.peso_volume,
              categoria: row.categoria,
              preco_normal: Number(row.preco_normal),
              preco_oferta: Number(row.preco_oferta),
              is_clube: Boolean(row.is_clube),
              data_fim: row.data_fim,
              created_at: row.created_at,
              mercado: {
                id: resolvedMercado.id,
                nome_rede: resolvedMercado.nome_rede,
                unidade: resolvedMercado.unidade,
                endereco: resolvedMercado.endereco,
                latitude: Number(resolvedMercado.latitude),
                longitude: Number(resolvedMercado.longitude),
              },
            },
          ];
        });

        setMercados(mercadosList);
        setOfertas(normalizedOffers);
      } catch (err) {
        if (!mounted) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Erro inesperado ao carregar as ofertas da região."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadVitrine();
    return () => {
      mounted = false;
    };
  }, []);

  const categoryPills = useMemo(() => {
    const baseSet = new Set<string>(BASE_CATEGORIES);
    const extras: string[] = [];
    for (const offer of ofertas) {
      if (offer.categoria && !baseSet.has(offer.categoria)) {
        baseSet.add(offer.categoria);
        extras.push(offer.categoria);
      }
    }
    return [...BASE_CATEGORIES, ...extras];
  }, [ofertas]);

  const cartQtyByOfferId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cartItems) {
      map.set(item.id, item.quantity);
    }
    return map;
  }, [cartItems]);

  const filteredOfertas = useMemo(() => {
    const query = normalizeSearchText(searchTerm);

    return ofertas.filter((offer) => {
      if (
        selectedCategory !== "Todos" &&
        offer.categoria.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }

      if (
        selectedMercadoId !== "todos" &&
        offer.mercado_id !== selectedMercadoId
      ) {
        return false;
      }

      if (query) {
        const haystack = normalizeSearchText(
          `${offer.produto_nome} ${offer.marca ?? ""}`
        );
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [ofertas, searchTerm, selectedCategory, selectedMercadoId]);

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    selectedCategory !== "Todos" ||
    selectedMercadoId !== "todos";

  function clearFilters() {
    setSearchTerm("");
    setSelectedCategory("Todos");
    setSelectedMercadoId("todos");
  }

  function handleQuickTagClick(tag: string) {
    setSearchTerm((prev) =>
      normalizeSearchText(prev) === normalizeSearchText(tag) ? "" : tag
    );
  }

  function handleApplyCustomRegion() {
    const trimmed = customRegionInput.trim();
    if (!trimmed) return;
    setRegionLabel(trimmed);
    setCustomRegionInput("");
    setRegionMenuOpen(false);
  }

  function handleAddToCart(offer: OfertaWithMercado) {
    addItem(
      {
        id: offer.id,
        produto_nome: offer.produto_nome,
        marca: offer.marca,
        peso_volume: offer.peso_volume,
        preco_normal: offer.preco_normal,
        preco_oferta: offer.preco_oferta,
        categoria: offer.categoria,
        is_clube: offer.is_clube,
      },
      {
        mercado_id: offer.mercado.id,
        nome_rede: offer.mercado.nome_rede,
        unidade: offer.mercado.unidade,
        lat: offer.mercado.latitude,
        lng: offer.mercado.longitude,
      }
    );

    showToast(
      "success",
      "Adicionado à sua cesta",
      `${offer.produto_nome} · ${offer.mercado.nome_rede}`
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF9] text-brand-dark">
      {/* Barra Superior Comercial */}
      <header className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-5">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark shadow-xs">
                <Store className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="text-lg font-extrabold tracking-tight text-brand-dark">
                CompreMatch
              </span>
            </Link>

            {/* Chip de Região */}
            <div ref={regionMenuRef} className="relative hidden md:block">
              <button
                id="region-selector-chip"
                type="button"
                aria-expanded={regionMenuOpen}
                aria-controls="region-selector-panel"
                onClick={() => setRegionMenuOpen((prev) => !prev)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-stone-200/90 bg-[#FAFAF9] px-3.5 py-1.5 text-xs font-medium text-brand-dark transition-all hover:border-brand-olive/60 hover:bg-white"
              >
                <MapPin
                  className="h-3.5 w-3.5 text-brand-gold"
                  aria-hidden="true"
                />
                <span className="font-semibold">{regionLabel}</span>
                <span className="text-brand-taupe underline decoration-brand-taupe/40 underline-offset-2">
                  Alterar
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-brand-taupe transition-transform ${
                    regionMenuOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {regionMenuOpen && (
                <div
                  id="region-selector-panel"
                  className="absolute top-full left-0 z-40 mt-2 w-80 rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-xl"
                >
                  <p className="text-xs font-bold text-brand-dark">
                    Escolha sua região
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-taupe">
                    Mostrando ofertas dos supermercados próximos a você.
                  </p>

                  <div className="mt-2.5 space-y-1">
                    {REGION_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setRegionLabel(preset);
                          setRegionMenuOpen(false);
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                          regionLabel === preset
                            ? "bg-brand-yellow/20 font-semibold text-brand-dark"
                            : "text-brand-taupe hover:bg-stone-50 hover:text-brand-dark"
                        }`}
                      >
                        <span>{preset}</span>
                        {regionLabel === preset && (
                          <span className="h-2 w-2 rounded-full bg-brand-gold" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-1.5 border-t border-stone-200/70 pt-3">
                    <label htmlFor="custom-region-input" className="sr-only">
                      Informar outra cidade ou bairro
                    </label>
                    <input
                      id="custom-region-input"
                      type="text"
                      value={customRegionInput}
                      onChange={(e) => setCustomRegionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleApplyCustomRegion();
                        }
                      }}
                      placeholder="Ex: São Paulo, SP • Saúde"
                      className="flex-1 rounded-xl border border-stone-200 bg-[#FAFAF9] px-3 py-1.5 text-xs text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-olive focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomRegion}
                      className="cursor-pointer rounded-xl bg-brand-yellow px-3 py-1.5 text-xs font-semibold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!authLoading && isAuthorizedStaff ? (
              <Link
                href="/admin/upload"
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-[#FAFAF9] px-3 py-2 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-olive hover:text-brand-dark"
              >
                <ShieldCheck
                  className="h-3.5 w-3.5 text-brand-olive"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Portal do Lojista</span>
                <span className="sm:hidden">Lojista</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-white px-3 py-2 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-olive hover:text-brand-dark"
              >
                <LogIn
                  className="h-3.5 w-3.5 text-brand-olive"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Portal do Lojista</span>
                <span className="sm:hidden">Entrar</span>
              </Link>
            )}

            <button
              id="navbar-cart-btn"
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-controls={drawerId}
              aria-expanded={drawerOpen}
              aria-label={`Abrir Sua Cesta Inteligente com ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-3.5 py-2 text-xs font-semibold text-brand-dark shadow-xs transition-all hover:bg-brand-gold active:scale-95 sm:px-4"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cesta</span>
              <span
                aria-hidden="true"
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-dark px-1.5 py-0.5 text-[11px] font-bold text-brand-yellow"
              >
                {cartCount}
              </span>
            </button>
          </div>
        </div>

        {/* Chip de região visível no mobile */}
        <div className="border-t border-stone-200/60 bg-[#FAFAF9] px-4 py-2 md:hidden">
          <button
            type="button"
            onClick={() => {
              const currentIndex = REGION_PRESETS.indexOf(
                regionLabel as (typeof REGION_PRESETS)[number]
              );
              const nextPreset =
                REGION_PRESETS[(currentIndex + 1) % REGION_PRESETS.length];
              setRegionLabel(nextPreset);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-dark"
          >
            <MapPin
              className="h-3.5 w-3.5 text-brand-gold"
              aria-hidden="true"
            />
            <span className="font-semibold">{regionLabel}</span>
            <span className="text-brand-taupe underline underline-offset-2">
              Alterar
            </span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero Minimalista + Busca Centralizada */}
        <section
          aria-label="Busca e descoberta de ofertas"
          className="mx-auto max-w-4xl text-center"
        >
          <h1 className="text-3xl font-black tracking-tight text-brand-dark sm:text-4xl lg:text-[42px] lg:leading-[1.12]">
            Economize até 35% no supermercado comparando encartes da sua região.
          </h1>
          <p className="mx-auto mt-3.5 max-w-2xl text-base leading-relaxed text-brand-taupe sm:text-lg">
            Encontre os menores preços, monte sua cesta multiloja e trace o
            trajeto mais econômico.
          </p>

          {/* Barra de Busca Proeminente Centralizada */}
          <div className="mx-auto mt-7 max-w-2xl">
            <label htmlFor="vitrine-search-input" className="sr-only">
              Buscar por produto ou marca
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-brand-olive"
                aria-hidden="true"
              />
              <input
                id="vitrine-search-input"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="O que você procura hoje? Ex: Café, Azeite, Arroz, Detergente..."
                className="w-full rounded-2xl border border-stone-200/90 bg-white py-3.5 pr-11 pl-12 text-sm font-medium text-brand-dark shadow-sm placeholder:text-brand-taupe/60 transition-all focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none sm:text-base"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded-lg p-1.5 text-brand-taupe transition-colors hover:bg-stone-100 hover:text-brand-dark"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Atalhos Rápidos em Tags */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="font-medium text-brand-taupe">Em alta:</span>
              {QUICK_SEARCH_TAGS.map((tag) => {
                const isSelected =
                  normalizeSearchText(searchTerm) === normalizeSearchText(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleQuickTagClick(tag)}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-all active:scale-95 ${
                      isSelected
                        ? "border-brand-gold bg-brand-yellow/25 text-brand-dark"
                        : "border-stone-200/80 bg-white text-brand-taupe hover:border-brand-olive hover:text-brand-dark"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Barra de Categorias (Carrossel Horizontal) + Filtro de Mercado */}
        <section
          aria-label="Filtros por categoria e supermercado"
          className="mt-9 flex flex-col gap-3 border-y border-stone-200/70 py-4 md:flex-row md:items-center md:justify-between"
        >
          <div className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            {categoryPills.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedCategory(category)}
                  className={`shrink-0 cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-all active:scale-95 ${
                    isActive
                      ? "border-brand-dark bg-brand-dark text-brand-yellow shadow-xs"
                      : "border-stone-200/80 bg-white text-brand-dark hover:border-brand-olive hover:bg-brand-yellow/10"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1 md:flex-initial">
              <label htmlFor="vitrine-market-select" className="sr-only">
                Filtrar por supermercado
              </label>
              <Store
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-brand-olive"
                aria-hidden="true"
              />
              <select
                id="vitrine-market-select"
                value={selectedMercadoId}
                onChange={(e) => setSelectedMercadoId(e.target.value)}
                className="w-full rounded-xl border border-stone-200/90 bg-white py-2 pr-3.5 pl-9 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-olive focus:border-brand-olive focus:ring-2 focus:ring-brand-yellow/35 focus:outline-none"
              >
                <option value="todos">Todos os supermercados</option>
                {mercados.map((mercado) => (
                  <option key={mercado.id} value={mercado.id}>
                    {mercado.nome_rede} • {mercado.unidade}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="shrink-0 cursor-pointer text-xs font-semibold text-brand-olive underline underline-offset-2 hover:text-brand-dark"
              >
                Limpar
              </button>
            )}
          </div>
        </section>

        {/* Contador discreto */}
        <div className="mt-5 flex items-center justify-between text-xs text-brand-taupe">
          <span>
            {loading
              ? "Atualizando ofertas da sua região..."
              : `${filteredOfertas.length} ${
                  filteredOfertas.length === 1
                    ? "oferta encontrada"
                    : "ofertas encontradas"
                }`}
          </span>
          {selectedCategory !== "Todos" && (
            <span className="font-semibold text-brand-olive">
              Categoria: {selectedCategory}
            </span>
          )}
        </div>

        {/* Grade de Ofertas E-commerce */}
        <section aria-label="Ofertas em destaque" className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-64 animate-pulse rounded-2xl border border-stone-200/70 bg-white p-5"
                >
                  <div className="flex justify-between">
                    <div className="h-5 w-1/2 rounded-full bg-stone-100" />
                    <div className="h-5 w-1/4 rounded-full bg-stone-100" />
                  </div>
                  <div className="mt-5 h-5 w-4/5 rounded bg-stone-200/80" />
                  <div className="mt-2 h-4 w-1/2 rounded bg-stone-100" />
                  <div className="mt-10 h-8 w-1/3 rounded bg-brand-yellow/30" />
                  <div className="mt-4 h-10 w-full rounded-xl bg-stone-100" />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-stone-200/70 bg-white px-6 py-14 text-center">
              <AlertCircle
                className="h-9 w-9 text-red-600"
                aria-hidden="true"
              />
              <h2 className="mt-3 text-base font-bold text-brand-dark">
                Não foi possível carregar as ofertas
              </h2>
              <p className="mt-1 max-w-md text-xs text-brand-taupe">
                {errorMessage}
              </p>
            </div>
          ) : filteredOfertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-stone-200/70 bg-white px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow/20 text-brand-olive">
                <Tag className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-bold text-brand-dark">
                {ofertas.length === 0
                  ? "Nenhuma oferta ativa na sua região no momento"
                  : "Nenhuma oferta encontrada para essa busca"}
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-brand-taupe">
                {ofertas.length === 0
                  ? "Novos encartes de supermercados parceiros são atualizados diariamente."
                  : "Experimente limpar os filtros ou buscar por outro produto."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-semibold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                >
                  Ver todas as ofertas
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredOfertas.map((offer) => {
                const discountPct = getDiscountPercent(
                  offer.preco_normal,
                  offer.preco_oferta
                );
                const hasDiscount =
                  offer.preco_normal > offer.preco_oferta &&
                  offer.preco_normal > 0;
                const validity = formatValidityShort(offer.data_fim);
                const qtyInCart = cartQtyByOfferId.get(offer.id) ?? 0;

                return (
                  <article
                    key={offer.id}
                    className="group flex flex-col justify-between rounded-2xl border border-stone-200/70 bg-white p-5 transition-all hover:border-brand-olive/40 hover:shadow-md"
                  >
                    <div>
                      {/* Header minimalista do card: Mercado + Validade */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[#FAFAF9] px-2.5 py-1 text-[11px] font-semibold text-brand-taupe ring-1 ring-stone-200/80">
                          <Store
                            className="h-3 w-3 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {offer.mercado.nome_rede} • {offer.mercado.unidade}
                          </span>
                        </span>

                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            validity.isUrgent
                              ? "bg-amber-50 text-amber-800 ring-1 ring-amber-300/80"
                              : "bg-stone-100 text-brand-taupe"
                          }`}
                        >
                          {validity.label}
                        </span>
                      </div>

                      {/* Título do Produto + Marca e Volume */}
                      <div className="mt-4">
                        <h2 className="line-clamp-2 text-[15px] leading-snug font-bold text-brand-dark">
                          {offer.produto_nome}
                        </h2>

                        <p className="mt-1 text-xs font-medium text-brand-taupe">
                          {[offer.marca, offer.peso_volume]
                            .filter(Boolean)
                            .join(" • ") || offer.categoria}
                        </p>
                      </div>

                      {/* Tag de Fidelidade Preço Clube */}
                      {offer.is_clube && (
                        <div className="mt-3">
                          <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-yellow/15 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                            Preço Clube
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bloco de Preço + CTA Tátil */}
                    <div className="mt-5 border-t border-stone-100 pt-4">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          {hasDiscount ? (
                            <p className="text-xs font-medium text-brand-taupe/75 line-through">
                              {formatBRL(offer.preco_normal)}
                            </p>
                          ) : (
                            <span className="block h-4" aria-hidden="true" />
                          )}
                          <p className="text-2xl font-black tracking-tight text-brand-dark">
                            {formatBRL(offer.preco_oferta)}
                          </p>
                        </div>

                        {discountPct && (
                          <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
                            -{discountPct}%
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(offer)}
                        className="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brand-yellow px-4 py-2.5 text-sm font-semibold text-brand-dark shadow-xs transition-all hover:bg-brand-gold active:scale-95"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Adicionar
                        {qtyInCart > 0 && (
                          <span className="ml-1 rounded-full bg-brand-dark px-2 py-0.5 text-[11px] font-bold text-brand-yellow">
                            {qtyInCart}
                          </span>
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-stone-200/70 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-brand-taupe sm:px-6">
          <span className="font-semibold text-brand-dark">
            CompreMatch &copy; 2026
          </span>
          <span>Comparador inteligente de ofertas de supermercados</span>
        </div>
      </footer>

      <CartDrawer
        id={drawerId}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
