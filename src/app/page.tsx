"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Clock,
  LogIn,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
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

function getDaysUntilExpiration(dataFimIso: string): number {
  const match = dataFimIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 0;

  const endYear = Number(match[1]);
  const endMonth = Number(match[2]);
  const endDay = Number(match[3]);

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const endUtc = Date.UTC(endYear, endMonth - 1, endDay);

  return Math.round((endUtc - todayUtc) / 86_400_000);
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

function ExpirationBadge({ dataFim }: { dataFim: string }) {
  const daysLeft = getDaysUntilExpiration(dataFim);

  if (daysLeft <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Vence hoje!
      </span>
    );
  }

  if (daysLeft <= 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold bg-brand-yellow/25 px-2.5 py-0.5 text-[11px] font-bold text-brand-dark">
        <Clock className="h-3 w-3 text-brand-olive" aria-hidden="true" />
        {daysLeft === 1 ? "Vence em 1 dia" : `Vence em ${daysLeft} dias`}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-taupe/25 bg-[#faf7ef] px-2.5 py-0.5 text-[11px] font-medium text-brand-taupe">
      <Clock className="h-3 w-3 text-brand-olive" aria-hidden="true" />
      Vence em {daysLeft} dias
    </span>
  );
}

export default function VitrinePublicaPage() {
  const { isAuthorizedStaff, loading: authLoading } = useAuth();
  const { items: cartItems, addItem, getItemCount } = useCart();

  const [ofertas, setOfertas] = useState<OfertaWithMercado[]>([]);
  const [mercados, setMercados] = useState<MercadoJoin[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [selectedMercadoId, setSelectedMercadoId] = useState<string>("todos");

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const drawerId = "smart-cart-drawer";
  const cartCount = getItemCount();

  const showToast = useCallback(
    (type: ToastMessage["type"], title: string, description?: string) => {
      setToast({ id: Date.now(), type, title, description });
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    async function loadVitrine() {
      if (!isSupabaseConfigured()) {
        if (mounted) {
          setErrorMessage(
            "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY."
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
            : "Erro inesperado ao carregar a vitrine de ofertas."
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
      "Adicionado ao carrinho",
      `${offer.produto_nome} (${offer.mercado.nome_rede})`
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fcfaf5] text-brand-dark">
      {/* Navbar Superior */}
      <header className="sticky top-0 z-30 border-b border-brand-taupe/20 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark shadow-xs">
              <Store className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <span className="block text-base font-extrabold tracking-tight text-brand-dark sm:text-lg">
                CompreMatch
              </span>
              <span className="hidden text-[11px] font-medium text-brand-taupe sm:block">
                Ofertas locais em tempo real
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2.5 sm:gap-3">
            {!authLoading && isAuthorizedStaff ? (
              <Link
                href="/admin/upload"
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-taupe/30 bg-[#faf7ef] px-3 py-2 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-olive hover:text-brand-dark"
              >
                <ShieldCheck
                  className="h-3.5 w-3.5 text-brand-olive"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Painel Admin</span>
                <span className="sm:hidden">Admin</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-taupe/30 bg-white px-3 py-2 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-olive hover:text-brand-dark"
              >
                <LogIn className="h-3.5 w-3.5 text-brand-olive" aria-hidden="true" />
                <span className="hidden sm:inline">Acesso Restrito</span>
                <span className="sm:hidden">Entrar</span>
              </Link>
            )}

            <button
              id="navbar-cart-btn"
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-controls={drawerId}
              aria-expanded={drawerOpen}
              aria-label={`Abrir carrinho com ${cartCount} ${cartCount === 1 ? "item" : "itens"}`}
              className="relative inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-dark px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-brand-taupe sm:px-4"
            >
              <ShoppingBag
                className="h-4 w-4 text-brand-yellow"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Carrinho</span>
              <span
                aria-hidden="true"
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand-yellow px-1.5 py-0.5 text-[11px] font-extrabold text-brand-dark"
              >
                {cartCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* Hero compacto + Barra de Filtros */}
        <section
          aria-label="Filtros da vitrine de ofertas"
          className="rounded-2xl border border-brand-taupe/25 bg-white p-5 shadow-2xs sm:p-6"
        >
          <div className="flex flex-col justify-between gap-4 border-b border-brand-taupe/15 pb-5 md:flex-row md:items-end">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-yellow/25 px-3 py-1 text-xs font-bold text-brand-dark">
                <Sparkles
                  className="h-3.5 w-3.5 text-brand-olive"
                  aria-hidden="true"
                />
                Vitrine Pública de Encartes
              </span>
              <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-brand-dark sm:text-3xl">
                Compare ofertas válidas perto de você
              </h1>
              <p className="mt-1 text-sm text-brand-taupe">
                Busque produtos, filtre por categoria ou mercado e monte seu
                carrinho agrupado por loja.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-brand-taupe">
              <span className="rounded-lg bg-[#faf7ef] px-3 py-1.5 border border-brand-taupe/20">
                {loading
                  ? "Carregando..."
                  : `${filteredOfertas.length} ${filteredOfertas.length === 1 ? "oferta ativa" : "ofertas ativas"}`}
              </span>
            </div>
          </div>

          {/* Controles de busca e mercado */}
          <div className="mt-5 grid gap-3 md:grid-cols-12">
            <div className="md:col-span-8">
              <label htmlFor="vitrine-search-input" className="sr-only">
                Buscar por nome do produto ou marca
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-brand-olive"
                  aria-hidden="true"
                />
                <input
                  id="vitrine-search-input"
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar produto ou marca (ex: Arroz, Camil, Café, OMO)..."
                  className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-9 pl-10 text-sm font-medium text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    aria-label="Limpar busca"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded-md p-1 text-brand-taupe hover:bg-brand-yellow/20 hover:text-brand-dark"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className="md:col-span-4">
              <label htmlFor="vitrine-market-select" className="sr-only">
                Filtrar por mercado
              </label>
              <div className="relative">
                <Store
                  className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-brand-olive"
                  aria-hidden="true"
                />
                <select
                  id="vitrine-market-select"
                  value={selectedMercadoId}
                  onChange={(e) => setSelectedMercadoId(e.target.value)}
                  className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-3.5 pl-10 text-sm font-medium text-brand-dark focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                >
                  <option value="todos">Todos os mercados</option>
                  {mercados.map((mercado) => (
                    <option key={mercado.id} value={mercado.id}>
                      {mercado.nome_rede} — {mercado.unidade}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Pills rápidas de Categoria */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {categoryPills.map((category) => {
              const isActive = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setSelectedCategory(category)}
                  className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-brand-dark bg-brand-dark text-brand-yellow"
                      : "border-brand-taupe/35 bg-[#faf7ef] text-brand-dark hover:border-brand-olive hover:bg-brand-yellow/15"
                  }`}
                >
                  {category}
                </button>
              );
            })}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto cursor-pointer text-xs font-semibold text-brand-olive underline underline-offset-2 hover:text-brand-dark"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </section>

        {/* Grade de Ofertas */}
        <section aria-label="Resultados de ofertas" className="mt-6">
          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-64 animate-pulse rounded-2xl border border-brand-taupe/20 bg-white p-5"
                >
                  <div className="h-5 w-2/3 rounded bg-brand-taupe/15" />
                  <div className="mt-4 h-6 w-4/5 rounded bg-brand-taupe/20" />
                  <div className="mt-2 h-4 w-1/2 rounded bg-brand-taupe/10" />
                  <div className="mt-10 h-8 w-1/3 rounded bg-brand-yellow/30" />
                  <div className="mt-4 h-10 w-full rounded-xl bg-brand-taupe/15" />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-red-300 bg-white px-6 py-12 text-center">
              <AlertCircle
                className="h-9 w-9 text-red-600"
                aria-hidden="true"
              />
              <h2 className="mt-3 text-base font-bold text-brand-dark">
                Erro ao carregar ofertas
              </h2>
              <p className="mt-1 max-w-md text-xs text-brand-taupe">
                {errorMessage}
              </p>
            </div>
          ) : filteredOfertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-brand-taupe/25 bg-white px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow/20 text-brand-olive">
                <Tag className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-bold text-brand-dark">
                {ofertas.length === 0
                  ? "Nenhuma oferta vigente publicada ainda"
                  : "Nenhuma oferta encontrada com os filtros atuais"}
              </h2>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-brand-taupe">
                {ofertas.length === 0
                  ? "Assim que novos encartes forem publicados no painel administrativo, as ofertas válidas aparecerão aqui."
                  : "Tente buscar outro produto, remover o filtro de mercado ou escolher outra categoria."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-bold text-brand-dark transition-colors hover:bg-brand-gold"
                >
                  Mostrar todas as ofertas
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredOfertas.map((offer) => {
                const hasDiscount =
                  offer.preco_normal > offer.preco_oferta &&
                  offer.preco_normal > 0;
                const qtyInCart = cartQtyByOfferId.get(offer.id) ?? 0;

                return (
                  <article
                    key={offer.id}
                    className="flex flex-col justify-between rounded-2xl border border-brand-taupe/25 bg-white p-5 shadow-2xs transition-shadow hover:shadow-md"
                  >
                    <div>
                      {/* Mercado + Clube */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-taupe/20 bg-[#faf7ef] px-2.5 py-1 text-[11px] font-semibold text-brand-taupe">
                          <MapPin
                            className="h-3 w-3 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {offer.mercado.nome_rede} · {offer.mercado.unidade}
                          </span>
                        </span>

                        {offer.is_clube && (
                          <span className="shrink-0 rounded-full bg-brand-olive px-2.5 py-0.5 text-[11px] font-bold text-white">
                            Clube
                          </span>
                        )}
                      </div>

                      {/* Categoria + Alerta de expiração */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-olive">
                          {offer.categoria}
                        </span>
                        <ExpirationBadge dataFim={offer.data_fim} />
                      </div>

                      {/* Nome, Marca e Peso/Volume */}
                      <h2 className="mt-2.5 text-base leading-snug font-bold text-brand-dark">
                        {offer.produto_nome}
                      </h2>

                      {(offer.marca || offer.peso_volume) && (
                        <p className="mt-1 text-xs font-medium text-brand-taupe">
                          {[offer.marca, offer.peso_volume]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>

                    {/* Preço + Ação */}
                    <div className="mt-5 border-t border-brand-taupe/15 pt-4">
                      <div className="min-h-12">
                        {hasDiscount && (
                          <p className="text-xs text-brand-taupe line-through">
                            De {formatBRL(offer.preco_normal)}
                          </p>
                        )}
                        <p className="text-2xl font-extrabold tracking-tight text-brand-dark">
                          {formatBRL(offer.preco_oferta)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(offer)}
                        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Adicionar
                        {qtyInCart > 0 && (
                          <span className="ml-1 rounded-full bg-brand-dark px-2 py-0.5 text-[11px] font-bold text-brand-yellow">
                            {qtyInCart} no carrinho
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

      <footer className="border-t border-brand-taupe/15 bg-white/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-brand-taupe sm:px-6">
          <span>CompreMatch &copy; 2026</span>
          <span className="font-medium text-brand-olive">
            Vitrine de Ofertas Locais
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
