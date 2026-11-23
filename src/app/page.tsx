"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Menu,
  Search,
  ShoppingBag,
  Store,
  Tag,
  X,
} from "lucide-react";
import { CartDrawer } from "@/components/CartDrawer";
import { ProductCard } from "@/components/ProductCard";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { getProductAsset, resolveCategoryKey } from "@/lib/categoryAssets";
import {
  groupMercadosByChain,
  normalizeChainKey,
  normalizeMatchText,
} from "@/lib/chains";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Mercado, Oferta } from "@/types/database";

const CATEGORY_FILTERS: ReadonlyArray<{
  label: string;
  key: string | null;
}> = [
  { label: "Todas", key: null },
  { label: "Bebidas", key: "bebidas" },
  { label: "Mercearia", key: "mercearia" },
  { label: "Hortifrúti", key: "hortifruti" },
  { label: "Açougue", key: "acougue" },
  { label: "Limpeza", key: "limpeza" },
  { label: "Descartáveis", key: "descartaveis_embalagens" },
  { label: "Higiene", key: "higiene_pessoal" },
  { label: "Bazar", key: "bazar_utilidades" },
];

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

function clsx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

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

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function buildProductChainKey(params: {
  nome_rede: string;
  produto_nome: string;
  marca: string | null;
  peso_volume: string | null;
  preco_oferta: number;
  is_clube: boolean;
}): string {
  return [
    normalizeChainKey(params.nome_rede),
    normalizeMatchText(params.produto_nome),
    normalizeMatchText(params.marca),
    normalizeMatchText(params.peso_volume),
    Number(params.preco_oferta).toFixed(2),
    params.is_clube ? "1" : "0",
  ].join("|");
}

interface ChainOption {
  key: string;
  nome_rede: string;
}

export default function VitrinePublicaPage() {
  const { isAuthorizedStaff, loading: authLoading } = useAuth();
  const { items: cartItems, addItem, getItemCount } = useCart();

  const [ofertas, setOfertas] = useState<OfertaWithMercado[]>([]);
  const [chains, setChains] = useState<ChainOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todas");
  const [selectedRede, setSelectedRede] = useState<string>("todos");

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
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

        // Deduplica ofertas idênticas cadastradas em filiais diferentes da mesma rede na Grande SP
        const dedupedMap = new Map<string, OfertaWithMercado>();
        for (const offer of normalizedOffers) {
          const key = buildProductChainKey({
            nome_rede: offer.mercado.nome_rede,
            produto_nome: offer.produto_nome,
            marca: offer.marca,
            peso_volume: offer.peso_volume,
            preco_oferta: offer.preco_oferta,
            is_clube: offer.is_clube,
          });
          const existing = dedupedMap.get(key);
          if (
            !existing ||
            offer.data_fim > existing.data_fim ||
            (offer.data_fim === existing.data_fim &&
              offer.created_at > existing.created_at)
          ) {
            dedupedMap.set(key, offer);
          }
        }
        const dedupedOffers = Array.from(dedupedMap.values());

        const chainMap = new Map<string, ChainOption>();
        for (const group of groupMercadosByChain(mercadosList)) {
          chainMap.set(group.key, {
            key: group.key,
            nome_rede: group.nome_rede,
          });
        }
        for (const offer of dedupedOffers) {
          const cleanName = offer.mercado.nome_rede.trim().replace(/\s+/g, " ");
          const key = normalizeChainKey(cleanName);
          if (key && !chainMap.has(key)) {
            chainMap.set(key, { key, nome_rede: cleanName });
          }
        }
        const uniqueChains = Array.from(chainMap.values()).sort((a, b) =>
          a.nome_rede.localeCompare(b.nome_rede, "pt-BR")
        );

        setChains(uniqueChains);
        setOfertas(dedupedOffers);
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

  const cartQtyLookup = useMemo(() => {
    const byId = new Map<string, number>();
    const byProductKey = new Map<string, number>();
    for (const item of cartItems) {
      byId.set(item.id, item.quantity);
      const key = buildProductChainKey({
        nome_rede: item.nome_rede,
        produto_nome: item.produto_nome,
        marca: item.marca,
        peso_volume: item.peso_volume,
        preco_oferta: item.preco_oferta,
        is_clube: item.is_clube,
      });
      byProductKey.set(key, (byProductKey.get(key) ?? 0) + item.quantity);
    }
    return { byId, byProductKey };
  }, [cartItems]);

  const selectedCategoryFilter = useMemo(
    () =>
      CATEGORY_FILTERS.find((item) => item.label === selectedCategory) ??
      CATEGORY_FILTERS[0],
    [selectedCategory]
  );

  const filteredOfertas = useMemo(() => {
    const query = normalizeSearchText(searchTerm);

    return ofertas.filter((offer) => {
      if (selectedCategoryFilter.key) {
        if (resolveCategoryKey(offer.categoria) !== selectedCategoryFilter.key) {
          return false;
        }
      }
      if (
        selectedRede !== "todos" &&
        normalizeChainKey(offer.mercado.nome_rede) !== selectedRede
      ) {
        return false;
      }
      if (query) {
        const haystack = normalizeSearchText(
          `${offer.produto_nome} ${offer.marca ?? ""} ${offer.mercado.nome_rede}`
        );
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [ofertas, searchTerm, selectedCategoryFilter, selectedRede]);

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    selectedCategory !== "Todas" ||
    selectedRede !== "todos";

  function clearFilters() {
    setSearchTerm("");
    setSelectedCategory("Todas");
    setSelectedRede("todos");
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
        nome_rede: offer.mercado.nome_rede,
      }
    );

    showToast(
      "success",
      "Adicionado à cesta",
      `${offer.produto_nome} · ${offer.mercado.nome_rede}`
    );
  }

  function selectCategoryAndScroll(label: string) {
    setSelectedCategory(label);
    document
      .getElementById("ofertas")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex min-h-screen flex-col text-brand-dark">
      {/* Navbar minimalista */}
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3 backdrop-blur-md sm:py-3.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href="/"
            className="shrink-0 font-serif text-xl font-semibold tracking-tight text-brand-dark sm:text-2xl"
            aria-label="CompreMatch — página inicial"
          >
            CompreMatch
          </Link>

          <nav
            aria-label="Principal"
            className="hidden items-center gap-6 text-sm font-medium text-brand-dark md:flex"
          >
            <a
              href="#como-funciona"
              className="transition-colors hover:text-brand-gold"
            >
              Como funciona
            </a>
            <a
              href="#parcerias"
              className="transition-colors hover:text-brand-gold"
            >
              Parcerias
            </a>
            <a
              href="#sobre"
              className="transition-colors hover:text-brand-gold"
            >
              Sobre
            </a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href={
                !authLoading && isAuthorizedStaff ? "/admin/upload" : "/login"
              }
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#333029]/30 px-3 py-1.5 text-xs font-medium text-brand-dark transition-colors hover:border-brand-gold hover:text-brand-gold sm:px-4 sm:text-sm"
            >
              {!authLoading && isAuthorizedStaff ? (
                <>
                  <span className="sm:hidden">Portal</span>
                  <span className="hidden sm:inline">Portal do lojista</span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Entrar</span>
                  <span className="hidden sm:inline">Login e cadastro</span>
                </>
              )}
            </Link>

            <button
              id="navbar-cart-btn"
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setDrawerOpen(true);
              }}
              aria-controls={drawerId}
              aria-expanded={drawerOpen}
              aria-label={`Abrir Sua Cesta Inteligente com ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
              className="relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-yellow px-3 py-2 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95 sm:gap-2 sm:px-3.5"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              <span>Cesta</span>
              {cartCount > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute -top-1.5 -right-1.5 rounded-full bg-brand-dark px-1.5 py-0.5 text-[10px] font-bold text-brand-yellow ${NUM}`}
                >
                  {cartCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-panel"
              aria-label={
                mobileMenuOpen ? "Fechar menu de navegação" : "Abrir menu de navegação"
              }
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/20 bg-white/70 text-brand-dark transition-colors hover:border-brand-gold md:hidden"
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Menu className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav
            id="mobile-nav-panel"
            aria-label="Menu mobile"
            className="mx-auto mt-3 max-w-6xl border-t border-[#333029]/10 px-4 pt-3 pb-1 md:hidden"
          >
            <div className="flex flex-col gap-1">
              <a
                href="#como-funciona"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-[#EDEAE3]"
              >
                Como funciona
              </a>
              <a
                href="#parcerias"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-[#EDEAE3]"
              >
                Parcerias
              </a>
              <a
                href="#sobre"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-[#EDEAE3]"
              >
                Sobre
              </a>
              <Link
                href="/rotas"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-[#EDEAE3]"
              >
                Ver Roteiro
              </Link>
              <Link
                href={
                  !authLoading && isAuthorizedStaff ? "/admin/upload" : "/login"
                }
                onClick={() => setMobileMenuOpen(false)}
                className="mt-1 inline-flex items-center justify-center rounded-full border border-[#333029]/25 bg-white px-4 py-2 text-sm font-semibold text-brand-dark transition-colors hover:border-brand-gold"
              >
                {!authLoading && isAuthorizedStaff
                  ? "Portal do lojista"
                  : "Login e cadastro"}
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* Hero assimétrico em split */}
        <section
          aria-labelledby="hero-title"
          className="mx-auto grid max-w-6xl items-center gap-8 px-4 pt-8 pb-6 sm:px-6 sm:pt-10 lg:grid-cols-2 lg:gap-12 lg:pt-14"
        >
          <div>
            <h1
              id="hero-title"
              className="font-serif text-[2.5rem] leading-[1.06] font-semibold tracking-tight text-balance text-brand-dark sm:text-5xl lg:text-6xl"
            >
              Economize até 35% no supermercado
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-brand-dark/85 sm:text-lg">
              Compare ofertas de encartes em tempo real, monte seu carrinho
              multimercado e descubra a melhor rota física para economizar de
              verdade nas suas compras.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#ofertas"
                className="inline-flex items-center gap-2 rounded-full bg-brand-yellow px-6 py-3 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
              >
                Ver Ofertas
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <Link
                href="/rotas"
                className="inline-flex items-center rounded-full border border-[#333029]/25 bg-transparent px-6 py-3 text-sm font-medium text-brand-dark transition-colors hover:border-brand-gold"
              >
                Ver Roteiro
              </Link>
            </div>
          </div>

          {/* Card editorial com badge flutuante */}
          <div className="relative pb-6 lg:pb-0">
            <div
              aria-hidden="true"
              className="grid aspect-[5/4] grid-cols-3 grid-rows-2 gap-px overflow-hidden rounded-[28px] bg-[#333029]/10"
            >
              {(
                [
                  "hortifruti",
                  "mercearia",
                  "frios_laticinios",
                  "matinais",
                  "padaria",
                  "temperos_condimentos",
                ] as const
              ).map((catKey, idx) => (
                <div
                  key={catKey}
                  className={`flex items-center justify-center p-4 sm:p-6 ${
                    idx % 2 === 0 ? "bg-[#F3F1EC]" : "bg-[#EDEAE3]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getProductAsset(catKey)}
                    alt=""
                    className="h-full max-h-28 w-full object-contain"
                  />
                </div>
              ))}
            </div>

            <div className="absolute -bottom-5 left-4 w-[min(18rem,calc(100%-2rem))] rounded-2xl border border-[#333029]/10 bg-white p-4 sm:left-6">
              <p className="text-xs font-medium text-brand-dark">
                Assaí <span className="text-brand-taupe">•</span> Carrefour{" "}
                <span className="float-right text-brand-taupe">Rota</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#333029]/10">
                <div className="h-full w-[72%] rounded-full bg-brand-gold" />
              </div>
              <p className={`mt-2 text-lg font-black text-emerald-800 ${NUM}`}>
                R$ 42,10{" "}
                <span className="font-sans text-xs font-medium tracking-normal text-brand-dark">
                  de economia
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Vitrine + Dock de Categorias */}
        <section
          id="ofertas"
          aria-labelledby="ofertas-title"
          className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-12 pb-16 sm:px-6"
        >
          {/* Barra horizontal de categorias */}
          <div
            role="group"
            aria-label="Filtrar por categoria"
            className="overflow-x-auto no-scrollbar flex gap-2 py-2 mb-6"
          >
            {CATEGORY_FILTERS.map((cat) => {
              const active = selectedCategory === cat.label;
              const thumb = cat.key ? getProductAsset(cat.key) : null;

              return (
                <button
                  key={cat.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectCategoryAndScroll(cat.label)}
                  className={clsx(
                    "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer",
                    active
                      ? "bg-[#333029] text-white"
                      : "bg-white border border-[#333029]/10 text-[#333029] hover:border-[#CC9B29]"
                  )}
                >
                  {thumb && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F3F1EC] p-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </span>
                  )}
                  {cat.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2
                id="ofertas-title"
                className="font-serif text-3xl font-medium tracking-tight text-brand-dark"
              >
                Ofertas em Destaque na Sua Região
              </h2>
              <p className={`mt-1 ${MICRO_LABEL} ${NUM}`}>
                {loading
                  ? "Carregando…"
                  : `${filteredOfertas.length} ${
                      filteredOfertas.length === 1 ? "oferta" : "ofertas"
                    } · Grande São Paulo`}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-72">
                <label htmlFor="vitrine-search-input" className="sr-only">
                  Buscar produtos, marcas ou mercados
                </label>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
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
                  placeholder="Buscar produtos, marcas ou mercados…"
                  className="w-full rounded-lg border border-[#333029]/10 bg-white py-2.5 pr-14 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/70 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
                <div className="absolute top-1/2 right-2 -translate-y-1/2">
                  {searchTerm ? (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      aria-label="Limpar busca"
                      className="cursor-pointer rounded-md p-1 text-brand-taupe hover:text-brand-dark"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <kbd
                      aria-hidden="true"
                      className="hidden rounded border border-[#333029]/15 bg-[#F8F7F4] px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-taupe sm:inline"
                    >
                      Ctrl K
                    </kbd>
                  )}
                </div>
              </div>

              <div className="relative sm:w-56">
                <label htmlFor="vitrine-market-select" className="sr-only">
                  Filtrar por supermercado
                </label>
                <Store
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
                  aria-hidden="true"
                />
                <select
                  id="vitrine-market-select"
                  value={selectedRede}
                  onChange={(e) => setSelectedRede(e.target.value)}
                  className="w-full rounded-lg border border-[#333029]/10 bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                >
                  <option value="todos">Todos os mercados</option>
                  {chains.map((chain) => (
                    <option key={chain.key} value={chain.key}>
                      {chain.nome_rede}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 cursor-pointer text-xs font-semibold text-brand-olive underline underline-offset-4 hover:text-brand-dark"
            >
              Limpar filtros
            </button>
          )}

          <div className="mt-6">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="h-80 animate-pulse overflow-hidden rounded-2xl border border-[#333029]/10 bg-white p-3.5"
                  >
                    <div className="h-40 rounded-xl bg-[#F3F1EC]" />
                    <div className="mt-3 space-y-2">
                      <div className="h-3 w-1/2 rounded bg-[#F3F1EC]" />
                      <div className="h-5 w-2/3 rounded bg-[#F3F1EC]" />
                      <div className="h-8 w-full rounded-lg bg-brand-yellow/25" />
                    </div>
                  </div>
                ))}
              </div>
            ) : errorMessage ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-[#333029]/10 bg-white px-6 py-12 text-center">
                <AlertCircle
                  className="h-8 w-8 text-red-600"
                  aria-hidden="true"
                />
                <h3 className="mt-3 text-sm font-bold text-brand-dark">
                  Não foi possível carregar as ofertas
                </h3>
                <p className="mt-1 max-w-md text-xs text-brand-taupe">
                  {errorMessage}
                </p>
              </div>
            ) : filteredOfertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-[#333029]/10 bg-white px-6 py-14 text-center">
                <Tag className="h-6 w-6 text-brand-olive" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-bold text-brand-dark">
                  {ofertas.length === 0
                    ? "Nenhuma oferta ativa na região no momento"
                    : "Nenhuma oferta para essa busca"}
                </h3>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {filteredOfertas.map((offer) => (
                  <ProductCard
                    key={offer.id}
                    produto={{
                      id: offer.id,
                      nome: offer.produto_nome,
                      marca: offer.marca,
                      peso_volume: offer.peso_volume,
                      categoria: offer.categoria,
                      preco_normal: offer.preco_normal,
                      preco_oferta: offer.preco_oferta,
                      is_clube: offer.is_clube,
                      data_fim: offer.data_fim,
                      mercado_nome: offer.mercado.nome_rede,
                    }}
                    qtyInCart={
                      cartQtyLookup.byId.get(offer.id) ??
                      cartQtyLookup.byProductKey.get(
                        buildProductChainKey({
                          nome_rede: offer.mercado.nome_rede,
                          produto_nome: offer.produto_nome,
                          marca: offer.marca,
                          peso_volume: offer.peso_volume,
                          preco_oferta: offer.preco_oferta,
                          is_clube: offer.is_clube,
                        })
                      ) ??
                      0
                    }
                    onAdd={() => handleAddToCart(offer)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Seções de apoio da navbar */}
        <section
          id="como-funciona"
          className="scroll-mt-24 border-t border-[#333029]/10 bg-white/60"
        >
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="font-serif text-3xl font-medium tracking-tight">
              Como funciona
            </h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                [
                  "01",
                  "Compare encartes",
                  "Ofertas válidas de supermercados perto de você, atualizadas todos os dias.",
                ],
                [
                  "02",
                  "Monte sua cesta",
                  "Adicione produtos de redes diferentes. Agrupamos tudo por parada.",
                ],
                [
                  "03",
                  "Siga a melhor rota",
                  "Calculamos o trajeto mais curto entre as lojas e mostramos quanto você economiza.",
                ],
              ].map(([n, title, text]) => (
                <li
                  key={n}
                  className="rounded-2xl border border-[#333029]/10 bg-white p-5"
                >
                  <span className={`${MICRO_LABEL} ${NUM}`}>{n}</span>
                  <h3 className="mt-2 text-base font-bold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-brand-taupe">
                    {text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="parcerias" className="scroll-mt-24">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="font-serif text-3xl font-medium tracking-tight">
                Parcerias
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-brand-taupe">
                Redes e lojistas publicam seus encartes no Portal do Lojista e
                alcançam quem compara preços antes de sair de casa.
              </p>
            </div>
            <div id="sobre" className="scroll-mt-24">
              <h2 className="font-serif text-3xl font-medium tracking-tight">
                Sobre
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-brand-taupe">
                O CompreMatch conecta consumidores às melhores ofertas da
                vizinhança e transforma encartes em um roteiro de economia.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#333029]/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
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
