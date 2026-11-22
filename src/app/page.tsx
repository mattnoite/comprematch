"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  MapPin,
  Plus,
  Search,
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

const BAIRRO_PRESETS = [
  "Vila Mariana",
  "Moema",
  "Paraíso",
  "Ipiranga",
  "Pinheiros",
] as const;

const RADIUS_OPTIONS = [2, 5, 10] as const;

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

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

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const endUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  const diffDays = Math.round((endUtc - todayUtc) / 86_400_000);

  if (diffDays <= 0) {
    return { label: "Válido só hoje", isUrgent: true };
  }

  return {
    label: `Válido até ${match[3]}/${match[2]}`,
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

  const [bairro, setBairro] = useState<string>(BAIRRO_PRESETS[0]);
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [regionMenuOpen, setRegionMenuOpen] = useState<boolean>(false);
  const [customRegionInput, setCustomRegionInput] = useState<string>("");
  const regionMenuRef = useRef<HTMLDivElement | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
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

  // Atalhos de teclado: "/" e Ctrl/Cmd + K focam a busca
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

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
    setBairro(trimmed);
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
      "Adicionado à cesta",
      `${offer.produto_nome} · ${offer.mercado.nome_rede}`
    );
  }

  return (
    <div className="flex min-h-screen flex-col text-brand-dark">
      {/* Navbar compacta e fosca */}
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5"
            aria-label="CompreMatch — página inicial"
          >
            <span className="text-lg font-extrabold tracking-tighter text-brand-dark">
              CompreMatch
            </span>
            <span
              aria-hidden="true"
              className="mt-1 h-2 w-2 rounded-full bg-brand-yellow"
            />
          </Link>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* Seletor de localização */}
            <div ref={regionMenuRef} className="relative min-w-0">
              <button
                id="region-selector-chip"
                type="button"
                aria-expanded={regionMenuOpen}
                aria-controls="region-selector-panel"
                onClick={() => setRegionMenuOpen((prev) => !prev)}
                className="inline-flex max-w-[170px] cursor-pointer items-center gap-1.5 rounded-full border border-[#333029]/10 bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold sm:max-w-none"
              >
                <MapPin
                  className="h-3.5 w-3.5 shrink-0 text-brand-gold"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {bairro}, SP •{" "}
                  <span className={NUM}>Raio {radiusKm} km</span>
                </span>
                <ChevronDown
                  className={`h-3 w-3 shrink-0 text-brand-taupe transition-transform ${
                    regionMenuOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              {regionMenuOpen && (
                <div
                  id="region-selector-panel"
                  className="absolute top-full right-0 z-50 mt-2 w-72 rounded-xl border border-[#333029]/15 bg-white p-3"
                >
                  <p className={MICRO_LABEL}>Bairro</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {BAIRRO_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setBairro(preset);
                          setRegionMenuOpen(false);
                        }}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                          bairro === preset
                            ? "border-brand-dark bg-brand-dark text-white"
                            : "border-[#333029]/10 bg-white text-brand-dark hover:border-brand-gold"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <p className={`${MICRO_LABEL} mt-3`}>Raio de busca</p>
                  <div className="mt-2 flex gap-1.5">
                    {RADIUS_OPTIONS.map((km) => (
                      <button
                        key={km}
                        type="button"
                        aria-pressed={radiusKm === km}
                        onClick={() => setRadiusKm(km)}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-bold transition-colors ${NUM} ${
                          radiusKm === km
                            ? "border-brand-dark bg-brand-dark text-white"
                            : "border-[#333029]/10 bg-white text-brand-dark hover:border-brand-gold"
                        }`}
                      >
                        {km} km
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-1.5 border-t border-[#333029]/10 pt-3">
                    <label htmlFor="custom-region-input" className="sr-only">
                      Informar outro bairro
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
                      placeholder="Outro bairro"
                      className="min-w-0 flex-1 rounded-lg border border-[#333029]/10 bg-[#F8F7F4] px-2.5 py-1.5 text-xs text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomRegion}
                      className="cursor-pointer rounded-lg bg-brand-yellow px-3 py-1.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Link
              href={!authLoading && isAuthorizedStaff ? "/admin/upload" : "/login"}
              className="hidden shrink-0 text-xs font-semibold text-brand-taupe underline-offset-4 transition-colors hover:text-brand-dark hover:underline sm:inline"
            >
              {!authLoading && isAuthorizedStaff
                ? "Portal do Lojista"
                : "Sou lojista"}
            </Link>

            <button
              id="navbar-cart-btn"
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-controls={drawerId}
              aria-expanded={drawerOpen}
              aria-label={`Abrir Sua Cesta Inteligente com ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-[#333029]/10 bg-white py-1.5 pr-1.5 pl-3 text-xs font-bold text-brand-dark transition-colors hover:border-brand-gold"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cesta</span>
              <span
                aria-hidden="true"
                className="rounded-full bg-brand-dark px-2 py-0.5 font-mono text-xs font-bold text-brand-yellow tabular-nums"
              >
                {cartCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <h1 className="sr-only">Ofertas de supermercados na sua região</h1>

        {/* Console de busca utilitário */}
        <section
          aria-label="Busca e filtros"
          className="rounded-xl border border-[#333029]/10 bg-[#F3F1EC] p-3 sm:p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <label htmlFor="vitrine-search-input" className="sr-only">
                Buscar produto ou marca
              </label>
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-brand-olive"
                aria-hidden="true"
              />
              <input
                id="vitrine-search-input"
                ref={searchInputRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar produto ou marca…"
                className="w-full rounded-lg border border-[#333029]/10 bg-white py-3 pr-24 pl-10 text-sm font-medium text-brand-dark placeholder:text-brand-taupe/60 transition-colors focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
              />

              <div className="absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1.5">
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    aria-label="Limpar busca"
                    className="cursor-pointer rounded-md p-1 text-brand-taupe transition-colors hover:bg-[#F3F1EC] hover:text-brand-dark"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <span
                    aria-hidden="true"
                    className="hidden items-center gap-1 sm:flex"
                  >
                    <kbd className="rounded border border-[#333029]/15 bg-[#F8F7F4] px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-taupe">
                      Ctrl K
                    </kbd>
                    <kbd className="rounded border border-[#333029]/15 bg-[#F8F7F4] px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-taupe">
                      /
                    </kbd>
                  </span>
                )}
              </div>
            </div>

            <div className="relative lg:w-72">
              <label htmlFor="vitrine-market-select" className="sr-only">
                Filtrar por supermercado
              </label>
              <Store
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-olive"
                aria-hidden="true"
              />
              <select
                id="vitrine-market-select"
                value={selectedMercadoId}
                onChange={(e) => setSelectedMercadoId(e.target.value)}
                className="w-full rounded-lg border border-[#333029]/10 bg-white py-3 pr-3 pl-9 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
              >
                <option value="todos">Todos os supermercados</option>
                {mercados.map((mercado) => (
                  <option key={mercado.id} value={mercado.id}>
                    {mercado.nome_rede} • {mercado.unidade}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dock de categorias */}
          <div className="mt-3 flex items-center gap-2">
            <div
              role="group"
              aria-label="Categorias"
              className="no-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto"
            >
              {categoryPills.map((category) => {
                const isActive = selectedCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSelectedCategory(category)}
                    className={`shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                      isActive
                        ? "border-brand-dark bg-brand-dark text-white"
                        : "border-[#333029]/10 bg-white text-brand-dark hover:border-brand-gold"
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#333029]/10 pt-3">
            <span className={MICRO_LABEL}>Em alta</span>
            {QUICK_SEARCH_TAGS.map((tag) => {
              const isSelected =
                normalizeSearchText(searchTerm) === normalizeSearchText(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleQuickTagClick(tag)}
                  className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors ${
                    isSelected
                      ? "border-brand-gold bg-brand-yellow/15 text-brand-dark"
                      : "border-transparent text-brand-taupe hover:border-brand-gold hover:text-brand-dark"
                  }`}
                >
                  {tag}
                </button>
              );
            })}

            <span className="ml-auto flex items-center gap-3">
              <span className={`${MICRO_LABEL} ${NUM}`}>
                {loading
                  ? "Carregando…"
                  : `${filteredOfertas.length} ${
                      filteredOfertas.length === 1 ? "oferta" : "ofertas"
                    }`}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="cursor-pointer text-xs font-semibold text-brand-olive underline underline-offset-4 hover:text-brand-dark"
                >
                  Limpar filtros
                </button>
              )}
            </span>
          </div>
        </section>

        {/* Grade densa de ofertas */}
        <section aria-label="Ofertas" className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-48 animate-pulse rounded-xl border border-[#333029]/10 bg-white p-4"
                >
                  <div className="h-3 w-2/3 rounded bg-[#F3F1EC]" />
                  <div className="mt-4 h-4 w-4/5 rounded bg-[#F3F1EC]" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-[#F3F1EC]" />
                  <div className="mt-8 h-7 w-1/3 rounded bg-brand-yellow/25" />
                  <div className="mt-3 h-8 w-full rounded-lg bg-[#F3F1EC]" />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#333029]/10 bg-white px-6 py-12 text-center">
              <AlertCircle
                className="h-8 w-8 text-red-600"
                aria-hidden="true"
              />
              <h2 className="mt-3 text-sm font-bold text-brand-dark">
                Não foi possível carregar as ofertas
              </h2>
              <p className="mt-1 max-w-md text-xs text-brand-taupe">
                {errorMessage}
              </p>
            </div>
          ) : filteredOfertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#333029]/10 bg-white px-6 py-14 text-center">
              <Tag className="h-6 w-6 text-brand-olive" aria-hidden="true" />
              <h2 className="mt-3 text-sm font-bold text-brand-dark">
                {ofertas.length === 0
                  ? "Nenhuma oferta ativa na região no momento"
                  : "Nenhuma oferta para essa busca"}
              </h2>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-brand-taupe">
                {ofertas.length === 0
                  ? "Novos encartes são publicados diariamente pelos supermercados parceiros."
                  : "Ajuste os filtros ou busque por outro produto."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 cursor-pointer rounded-lg bg-brand-yellow px-4 py-2 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                >
                  Ver todas as ofertas
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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
                    className="flex flex-col justify-between rounded-xl border border-[#333029]/10 bg-white p-4 transition-colors duration-200 hover:border-brand-gold/60"
                  >
                    <div>
                      {/* Linha 1: rede + vigência */}
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-brand-dark">
                          <Store
                            className="h-3.5 w-3.5 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {offer.mercado.nome_rede} • {offer.mercado.unidade}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-[11px] font-medium ${
                            validity.isUrgent
                              ? "text-red-700"
                              : "text-brand-taupe"
                          }`}
                        >
                          {validity.label}
                        </span>
                      </div>

                      {/* Miolo */}
                      <h2 className="mt-1 line-clamp-2 text-sm font-semibold text-brand-dark">
                        {offer.produto_nome}
                      </h2>
                      <p className="mt-0.5 text-xs text-brand-taupe">
                        {[offer.marca, offer.peso_volume]
                          .filter(Boolean)
                          .join(" • ") || offer.categoria}
                      </p>
                    </div>

                    {/* Preço & ação */}
                    <div className="mt-4">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          {hasDiscount ? (
                            <p
                              className={`text-xs text-brand-taupe line-through ${NUM}`}
                            >
                              {formatBRL(offer.preco_normal)}
                            </p>
                          ) : (
                            <span className="block h-4" aria-hidden="true" />
                          )}
                          <p
                            className={`text-2xl font-black text-brand-dark ${NUM}`}
                          >
                            {formatBRL(offer.preco_oferta)}
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          {discountPct && (
                            <span
                              className={`text-[10px] font-bold uppercase tracking-widest text-brand-taupe ${NUM}`}
                            >
                              −{discountPct}%
                            </span>
                          )}
                          {offer.is_clube && (
                            <span className="rounded border border-brand-yellow/40 bg-brand-yellow/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-dark">
                              Clube
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(offer)}
                        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-brand-yellow py-2 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        Adicionar
                        {qtyInCart > 0 && (
                          <span
                            className={`ml-1 rounded-full bg-brand-dark px-1.5 py-0.5 text-[10px] font-bold text-brand-yellow ${NUM}`}
                          >
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

      <footer className="border-t border-[#333029]/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <span className={MICRO_LABEL}>CompreMatch © 2026</span>
          <span className={MICRO_LABEL}>
            Comparador de encartes de supermercado
          </span>
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
