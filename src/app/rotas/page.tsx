"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CircleDollarSign,
  Clock,
  Home,
  Loader2,
  LocateFixed,
  Navigation,
  Search,
  ShoppingBag,
} from "lucide-react";
import type { RouteMapOrigin, RouteMapStop } from "@/components/RouteMap";
import { useCart, type CartItem } from "@/hooks/useCart";
import { normalizeChainKey } from "@/lib/chains";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Mercado } from "@/types/database";

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-[#333029]/15 bg-white text-brand-taupe lg:h-[calc(100dvh-8rem)] lg:min-h-[560px]">
      <Loader2
        className="h-5 w-5 animate-spin text-brand-gold"
        aria-hidden="true"
      />
      <span className={MICRO_LABEL}>Carregando mapa</span>
    </div>
  ),
});

interface ChainBucket {
  chainKey: string;
  nome_rede: string;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}

interface MarketBucket {
  mercado_id: string;
  chainKey: string;
  nome_rede: string;
  unidade: string;
  endereco?: string;
  lat: number;
  lng: number;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  autoSelectedFromOrigin?: boolean;
}

interface OrderedStop extends MarketBucket {
  stopNumber: number;
}

interface OsrmRouteLeg {
  distance: number;
  duration: number;
}

const EMPTY_COORDS: Array<[number, number]> = [];
const EMPTY_LEGS: OsrmRouteLeg[] = [];
const EMPTY_STOPS: RouteMapStop[] = [];

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    legs?: OsrmRouteLeg[];
    geometry?: {
      type: string;
      coordinates: Array<[number, number]>;
    };
  }>;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDistanceKm(meters: number): string {
  const km = meters / 1000;
  return `${km.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} km`;
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function orderMarketsFromOrigin(
  markets: MarketBucket[],
  origin: RouteMapOrigin | null
): OrderedStop[] {
  if (markets.length === 0) return [];

  let ordered = [...markets];

  if (origin) {
    if (markets.length <= 7) {
      let bestOrder = ordered;
      let bestDistance = Number.POSITIVE_INFINITY;

      const permute = (
        current: MarketBucket[],
        remaining: MarketBucket[],
        accDistance: number,
        lastLat: number,
        lastLng: number
      ) => {
        if (accDistance >= bestDistance) return;
        if (remaining.length === 0) {
          bestDistance = accDistance;
          bestOrder = current;
          return;
        }
        for (let i = 0; i < remaining.length; i++) {
          const next = remaining[i];
          const stepDist = haversineMeters(lastLat, lastLng, next.lat, next.lng);
          permute(
            [...current, next],
            remaining.filter((_, idx) => idx !== i),
            accDistance + stepDist,
            next.lat,
            next.lng
          );
        }
      };

      permute([], markets, 0, origin.lat, origin.lng);
      ordered = bestOrder;
    } else {
      const remaining = [...markets];
      const result: MarketBucket[] = [];
      let curLat = origin.lat;
      let curLng = origin.lng;

      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < remaining.length; i++) {
          const d = haversineMeters(
            curLat,
            curLng,
            remaining[i].lat,
            remaining[i].lng
          );
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        const [chosen] = remaining.splice(bestIdx, 1);
        result.push(chosen);
        curLat = chosen.lat;
        curLng = chosen.lng;
      }

      ordered = result;
    }
  }

  return ordered.map((market, index) => ({
    ...market,
    stopNumber: index + 1,
  }));
}

function buildGoogleMapsUrl(
  origin: RouteMapOrigin | null,
  stops: OrderedStop[]
): string | null {
  if (stops.length === 0) return null;

  const lastStop = stops[stops.length - 1];
  const params = new URLSearchParams({
    api: "1",
    destination: `${lastStop.lat},${lastStop.lng}`,
    travelmode: "driving",
  });

  if (origin) {
    params.set("origin", `${origin.lat},${origin.lng}`);
  }

  if (stops.length > 1) {
    const waypoints = stops
      .slice(0, -1)
      .map((stop) => `${stop.lat},${stop.lng}`)
      .join("|");
    params.set("waypoints", waypoints);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildWazeUrl(stops: OrderedStop[]): string | null {
  if (stops.length === 0) return null;
  const firstStop = stops[0];
  return `https://waze.com/ul?ll=${firstStop.lat},${firstStop.lng}&navigate=yes`;
}

export default function RotasPage() {
  const { items, hydrated, getCartTotal, getItemCount } = useCart();

  const [origin, setOrigin] = useState<RouteMapOrigin | null>(null);
  const [addressQuery, setAddressQuery] = useState<string>("");
  const [locatingGps, setLocatingGps] = useState<boolean>(false);
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [originError, setOriginError] = useState<string | null>(null);

  const [routeResult, setRouteResult] = useState<{
    key: string;
    coordinates: Array<[number, number]>;
    distanceMeters: number;
    durationSeconds: number;
    legs: OsrmRouteLeg[];
  } | null>(null);
  const [routeErrorState, setRouteErrorState] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const [fallbackNormalPrices, setFallbackNormalPrices] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const missingIds = items
      .filter((item) => item.preco_normal === undefined)
      .map((item) => item.id);

    if (missingIds.length === 0 || !isSupabaseConfigured()) return;

    let active = true;
    const supabase = getSupabaseClient();

    supabase
      .from("ofertas")
      .select("id, preco_normal")
      .in("id", missingIds)
      .then(({ data }) => {
        if (!active || !Array.isArray(data)) return;
        const map: Record<string, number> = {};
        for (const row of data as Array<{ id: string; preco_normal: number }>) {
          map[row.id] = Number(row.preco_normal);
        }
        setFallbackNormalPrices(map);
      });

    return () => {
      active = false;
    };
  }, [items]);

  const [mercados, setMercados] = useState<Mercado[]>([]);
  const [loadingMercados, setLoadingMercados] = useState<boolean>(() =>
    isSupabaseConfigured()
  );
  const [mercadosError, setMercadosError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let active = true;
    const supabase = getSupabaseClient();

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("mercados")
          .select(
            "id, nome_rede, unidade, endereco, latitude, longitude, created_at"
          )
          .order("nome_rede", { ascending: true });

        if (!active) return;

        if (error) {
          setMercadosError(
            "Não foi possível consultar as filiais na Grande São Paulo."
          );
          return;
        }

        setMercados((data as Mercado[]) ?? []);
        setMercadosError(null);
      } catch {
        if (!active) return;
        setMercadosError("Falha de conexão ao carregar filiais disponíveis.");
      } finally {
        if (active) setLoadingMercados(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const chainBuckets = useMemo<ChainBucket[]>(() => {
    const map = new Map<string, ChainBucket>();

    for (const item of items) {
      const chainKey = normalizeChainKey(item.nome_rede);
      if (!chainKey) continue;
      const existing = map.get(chainKey);
      if (existing) {
        existing.items.push(item);
        existing.itemCount += item.quantity;
        existing.subtotal += item.preco_oferta * item.quantity;
      } else {
        map.set(chainKey, {
          chainKey,
          nome_rede: item.nome_rede.trim(),
          items: [item],
          itemCount: item.quantity,
          subtotal: item.preco_oferta * item.quantity,
        });
      }
    }

    return Array.from(map.values());
  }, [items]);

  const { marketBuckets, missingChains } = useMemo(() => {
    if (!origin || loadingMercados) {
      return {
        marketBuckets: [] as MarketBucket[],
        missingChains: [] as string[],
      };
    }

    const branchesByChain = new Map<string, Mercado[]>();
    for (const branch of mercados) {
      const lat = Number(branch.latitude);
      const lng = Number(branch.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = normalizeChainKey(branch.nome_rede);
      if (!key) continue;
      const list = branchesByChain.get(key) ?? [];
      list.push({ ...branch, latitude: lat, longitude: lng });
      branchesByChain.set(key, list);
    }

    const resolved: MarketBucket[] = [];
    const missing: string[] = [];

    for (const bucket of chainBuckets) {
      const candidates = branchesByChain.get(bucket.chainKey) ?? [];
      if (candidates.length > 0) {
        let bestBranch = candidates[0];
        let bestDistance = haversineMeters(
          origin.lat,
          origin.lng,
          bestBranch.latitude,
          bestBranch.longitude
        );

        for (let i = 1; i < candidates.length; i++) {
          const candidate = candidates[i];
          const dist = haversineMeters(
            origin.lat,
            origin.lng,
            candidate.latitude,
            candidate.longitude
          );
          if (dist < bestDistance) {
            bestDistance = dist;
            bestBranch = candidate;
          }
        }

        resolved.push({
          mercado_id: bestBranch.id,
          chainKey: bucket.chainKey,
          nome_rede: bestBranch.nome_rede,
          unidade: bestBranch.unidade,
          endereco: bestBranch.endereco,
          lat: bestBranch.latitude,
          lng: bestBranch.longitude,
          items: bucket.items,
          itemCount: bucket.itemCount,
          subtotal: bucket.subtotal,
          autoSelectedFromOrigin: true,
        });
        continue;
      }

      const fallbackItem = bucket.items.find(
        (it) =>
          typeof it.lat === "number" &&
          Number.isFinite(it.lat) &&
          typeof it.lng === "number" &&
          Number.isFinite(it.lng)
      );

      if (
        fallbackItem &&
        fallbackItem.lat !== undefined &&
        fallbackItem.lng !== undefined
      ) {
        resolved.push({
          mercado_id: fallbackItem.mercado_id ?? bucket.chainKey,
          chainKey: bucket.chainKey,
          nome_rede: bucket.nome_rede,
          unidade: fallbackItem.unidade ?? "Unidade da rede",
          lat: fallbackItem.lat,
          lng: fallbackItem.lng,
          items: bucket.items,
          itemCount: bucket.itemCount,
          subtotal: bucket.subtotal,
          autoSelectedFromOrigin: false,
        });
      } else {
        missing.push(bucket.nome_rede);
      }
    }

    return { marketBuckets: resolved, missingChains: missing };
  }, [origin, loadingMercados, mercados, chainBuckets]);

  const orderedStops = useMemo<OrderedStop[]>(
    () => (origin ? orderMarketsFromOrigin(marketBuckets, origin) : []),
    [marketBuckets, origin]
  );

  const mapStops = useMemo<RouteMapStop[]>(() => {
    if (orderedStops.length === 0) return EMPTY_STOPS;
    return orderedStops.map((stop) => ({
      mercado_id: stop.mercado_id,
      nome_rede: stop.nome_rede,
      unidade: stop.unidade,
      lat: stop.lat,
      lng: stop.lng,
      subtotal: stop.subtotal,
      itemCount: stop.itemCount,
      stopNumber: stop.stopNumber,
    }));
  }, [orderedStops]);

  const totalFinalCompras = getCartTotal();
  const totalItemCount = getItemCount();

  const economiaLiquida = useMemo(() => {
    return items.reduce((sum, item) => {
      const normal =
        item.preco_normal ?? fallbackNormalPrices[item.id] ?? item.preco_oferta;
      const diff = Math.max(0, normal - item.preco_oferta);
      return sum + diff * item.quantity;
    }, 0);
  }, [items, fallbackNormalPrices]);

  const routeKey = useMemo(() => {
    if (!origin || orderedStops.length === 0) return "";
    return `${origin.lat},${origin.lng};${orderedStops
      .map((stop) => `${stop.mercado_id}:${stop.lat},${stop.lng}`)
      .join(";")}`;
  }, [origin, orderedStops]);

  const activeRoute =
    routeKey && routeResult?.key === routeKey ? routeResult : null;
  const routeError =
    routeKey && routeErrorState?.key === routeKey
      ? routeErrorState.message
      : null;
  const routeLoading = Boolean(routeKey) && !activeRoute && !routeError;

  const routeCoordinates = activeRoute?.coordinates ?? EMPTY_COORDS;
  const totalDistanceMeters = activeRoute?.distanceMeters ?? null;
  const totalDurationSeconds = activeRoute?.durationSeconds ?? null;
  const routeLegs = activeRoute?.legs ?? EMPTY_LEGS;

  useEffect(() => {
    if (!routeKey || !origin || orderedStops.length === 0) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const currentOrigin = origin;
    const currentStops = orderedStops;
    const currentKey = routeKey;

    async function calculateOsrmRoute() {
      try {
        const waypoints = [
          `${currentOrigin.lng},${currentOrigin.lat}`,
          ...currentStops.map((stop) => `${stop.lng},${stop.lat}`),
        ].join(";");

        const url = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`OSRM retornou status ${response.status}`);
        }

        const data = (await response.json()) as OsrmRouteResponse;
        const primaryRoute = data.routes?.[0];

        if (
          data.code !== "Ok" ||
          !primaryRoute ||
          !primaryRoute.geometry?.coordinates?.length
        ) {
          throw new Error("Não foi possível traçar o percurso viário.");
        }

        if (!active) return;

        const latLngCoords: Array<[number, number]> =
          primaryRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        setRouteResult({
          key: currentKey,
          coordinates: latLngCoords,
          distanceMeters: primaryRoute.distance,
          durationSeconds: primaryRoute.duration,
          legs: primaryRoute.legs ?? [],
        });
      } catch (err) {
        if (!active || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setRouteErrorState({
          key: currentKey,
          message:
            err instanceof Error
              ? `Não foi possível calcular a rota viária: ${err.message}`
              : "Erro ao consultar o serviço de rotas.",
        });
      }
    }

    void calculateOsrmRoute();

    return () => {
      active = false;
      controller.abort();
    };
  }, [routeKey, origin, orderedStops]);

  function handleUseCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setOriginError(
        "Geolocalização indisponível neste navegador. Informe seu CEP ou endereço."
      );
      return;
    }

    setOriginError(null);
    setLocatingGps(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Minha localização atual",
        });
        setLocatingGps(false);
      },
      (geoErr) => {
        setLocatingGps(false);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setOriginError(
            "Permissão de localização negada. Digite seu CEP ou endereço."
          );
        } else {
          setOriginError(
            "Não foi possível obter sua localização. Tente informar seu CEP ou endereço."
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }

  async function handleSearchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = addressQuery.trim();
    if (!query) {
      setOriginError("Digite um CEP ou endereço de partida.");
      return;
    }

    setOriginError(null);
    setGeocoding(true);

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}`
      );
      const data = (await response.json()) as {
        lat?: number;
        lng?: number;
        label?: string;
        error?: string;
      };

      if (!response.ok || data.lat === undefined || data.lng === undefined) {
        setOriginError(
          data.error ?? "Não foi possível localizar o CEP ou endereço."
        );
        return;
      }

      setOrigin({
        lat: data.lat,
        lng: data.lng,
        label: data.label ?? query,
      });
    } catch {
      setOriginError("Falha de conexão ao buscar o endereço.");
    } finally {
      setGeocoding(false);
    }
  }

  const googleMapsUrl = useMemo(
    () => buildGoogleMapsUrl(origin, orderedStops),
    [origin, orderedStops]
  );
  const wazeUrl = useMemo(() => buildWazeUrl(orderedStops), [orderedStops]);

  return (
    <div className="flex min-h-screen flex-col text-brand-dark">
      {/* Navbar minimalista */}
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="font-serif text-2xl font-semibold tracking-tight text-brand-dark"
            aria-label="CompreMatch — página inicial"
          >
            CompreMatch
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#333029]/25 px-3.5 py-1.5 text-xs font-medium text-brand-dark transition-colors hover:border-brand-gold"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Ofertas
            </Link>
            <span className="inline-flex items-center gap-2 rounded-lg bg-[#EDEAE3] px-3 py-2 text-xs font-bold text-brand-dark">
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
              <span className={NUM}>{totalItemCount}</span>
              <span className={`hidden sm:inline ${NUM}`}>
                · {formatBRL(totalFinalCompras)}
              </span>
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {!hydrated ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-2xl border border-[#333029]/10 bg-white p-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-gold" aria-hidden="true" />
            <p className={MICRO_LABEL}>Carregando sua cesta</p>
          </div>
        ) : items.length === 0 ? (
          <section className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-[#333029]/10 bg-white px-6 py-14 text-center">
            <ShoppingBag className="h-7 w-7 text-brand-olive" aria-hidden="true" />
            <h1 className="mt-3 font-serif text-2xl font-semibold tracking-tight text-brand-dark">
              Sua cesta está vazia
            </h1>
            <p className="mt-1 text-sm text-brand-taupe">
              Adicione ofertas ao carrinho para traçar sua rota
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar para as ofertas
            </Link>
          </section>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* Coluna esquerda */}
            <div className="space-y-5">
              <h1 className="font-serif text-4xl font-semibold tracking-tight text-brand-dark">
                Seu Roteiro de Economia
              </h1>

              {/* KPIs */}
              <section aria-label="Indicadores da rota" className="grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl border border-[#333029]/10 bg-white p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-brand-taupe">
                    <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                    Distância:
                  </p>
                  <p className={`mt-1 text-lg font-black text-brand-dark ${NUM}`}>
                    {totalDistanceMeters !== null
                      ? formatDistanceKm(totalDistanceMeters)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#333029]/10 bg-white p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-brand-taupe">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    Tempo:
                  </p>
                  <p className={`mt-1 text-lg font-black text-brand-dark ${NUM}`}>
                    {totalDurationSeconds !== null
                      ? formatDuration(totalDurationSeconds)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-brand-gold/40 bg-white p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-brand-olive">
                    <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                    Economia Líquida:
                  </p>
                  <p className={`mt-1 text-lg font-black text-brand-olive ${NUM}`}>
                    {formatBRL(economiaLiquida)}
                  </p>
                </div>
              </section>

              {/* Origem */}
              <section
                aria-label="Ponto de partida"
                className="rounded-2xl border border-[#333029]/10 bg-white p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    id="use-gps-btn"
                    type="button"
                    onClick={handleUseCurrentLocation}
                    disabled={locatingGps}
                    className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-yellow px-3.5 py-2.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {locatingGps ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Localizando…
                      </>
                    ) : (
                      <>
                        <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
                        Usar minha localização
                      </>
                    )}
                  </button>

                  <form
                    onSubmit={(e) => void handleSearchAddress(e)}
                    className="flex min-w-0 flex-1 gap-1.5"
                  >
                    <label htmlFor="origin-address-input" className="sr-only">
                      CEP ou endereço de saída
                    </label>
                    <div className="relative min-w-0 flex-1">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-brand-taupe"
                        aria-hidden="true"
                      />
                      <input
                        id="origin-address-input"
                        type="text"
                        value={addressQuery}
                        onChange={(e) => setAddressQuery(e.target.value)}
                        placeholder="CEP ou endereço"
                        className="w-full rounded-lg border border-[#333029]/10 bg-[#F8F7F4] py-2.5 pr-2.5 pl-8 text-xs text-brand-dark placeholder:text-brand-taupe/70 focus:border-brand-gold focus:outline-none"
                      />
                    </div>
                    <button
                      id="search-address-btn"
                      type="submit"
                      disabled={geocoding}
                      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/15 px-3 py-2.5 text-xs font-bold text-brand-dark transition-colors hover:border-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {geocoding ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        "Buscar"
                      )}
                    </button>
                  </form>
                </div>

                {originError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{originError}</span>
                  </div>
                )}
                {mercadosError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{mercadosError}</span>
                  </div>
                )}
                {missingChains.length > 0 && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-brand-gold/50 bg-brand-yellow/10 px-2.5 py-2 text-xs font-medium text-brand-dark"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold" aria-hidden="true" />
                    <span>
                      Sem filiais georreferenciadas na Grande SP para:{" "}
                      {missingChains.join(", ")}.
                    </span>
                  </div>
                )}
                {routeError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-brand-gold/50 bg-brand-yellow/10 px-2.5 py-2 text-xs font-medium text-brand-dark"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold" aria-hidden="true" />
                    <span>{routeError}</span>
                  </div>
                )}
              </section>

              {/* Stepper */}
              <ol aria-label="Sequência de paradas" className="pt-1">
                <li className="relative flex gap-3 pb-6">
                  <span
                    aria-hidden="true"
                    className="absolute top-7 bottom-0 left-[13px] border-l-2 border-dotted border-[#333029]/35"
                  />
                  <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center text-brand-dark">
                    <Home className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="pt-1 text-sm text-brand-dark">
                    <strong className="font-bold">Origem:</strong>{" "}
                    {origin ? origin.label : "defina seu ponto de partida"}
                  </p>
                </li>

                {!origin ? (
                  chainBuckets.map((chain, idx) => {
                    const isLast = idx === chainBuckets.length - 1;
                    return (
                      <li
                        key={chain.chainKey}
                        className={`relative flex gap-3 ${isLast ? "" : "pb-6"}`}
                      >
                        {!isLast && (
                          <span
                            aria-hidden="true"
                            className="absolute top-7 bottom-0 left-[13px] border-l-2 border-dotted border-[#333029]/35"
                          />
                        )}
                        <span
                          className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[#333029]/35 bg-[#F8F7F4] text-xs font-black text-brand-taupe ${NUM}`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-brand-dark">
                              <strong className="font-bold">
                                Parada {idx + 1}:
                              </strong>{" "}
                              {chain.nome_rede}
                            </p>
                            <span
                              className={`shrink-0 text-sm font-bold text-brand-dark ${NUM}`}
                            >
                              {formatBRL(chain.subtotal)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-brand-taupe">
                            <span className={NUM}>
                              • {chain.itemCount}{" "}
                              {chain.itemCount === 1 ? "item" : "itens"}
                            </span>{" "}
                            · filial mais próxima selecionada pela origem
                          </p>
                        </div>
                      </li>
                    );
                  })
                ) : loadingMercados ? (
                  <li className="flex items-center gap-3 pb-2 text-xs font-medium text-brand-taupe">
                    <Loader2
                      className="h-4 w-4 animate-spin text-brand-gold"
                      aria-hidden="true"
                    />
                    Localizando as filiais mais próximas da sua cesta…
                  </li>
                ) : (
                  orderedStops.map((stop, idx) => {
                    const leg = routeLegs[idx];
                    const isLast = idx === orderedStops.length - 1;
                    return (
                      <li
                        key={stop.mercado_id}
                        className={`relative flex gap-3 ${isLast ? "" : "pb-6"}`}
                      >
                        {!isLast && (
                          <span
                            aria-hidden="true"
                            className="absolute top-7 bottom-0 left-[13px] border-l-2 border-dotted border-[#333029]/35"
                          />
                        )}
                        <span
                          className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-[#F8F7F4] text-xs font-black text-brand-dark ${NUM}`}
                        >
                          {stop.stopNumber}
                        </span>
                        <div className="min-w-0 flex-1 pt-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-brand-dark">
                              <strong className="font-bold">
                                Parada {stop.stopNumber}:
                              </strong>{" "}
                              {stop.nome_rede} • {stop.unidade}
                            </p>
                            <span
                              className={`shrink-0 text-sm font-bold text-brand-dark ${NUM}`}
                            >
                              {formatBRL(stop.subtotal)}
                            </span>
                          </div>
                          {stop.autoSelectedFromOrigin && (
                            <p className="mt-0.5 text-[11px] font-semibold text-brand-olive">
                              Filial mais próxima selecionada automaticamente
                              {stop.endereco ? ` · ${stop.endereco}` : ""}
                            </p>
                          )}
                          <p className={`mt-0.5 text-xs text-brand-taupe ${NUM}`}>
                            • {stop.itemCount}{" "}
                            {stop.itemCount === 1 ? "item" : "itens"}
                            {leg &&
                              ` · ${formatDistanceKm(leg.distance)} · ${formatDuration(leg.duration)}`}
                          </p>
                        </div>
                      </li>
                    );
                  })
                )}
              </ol>

              {/* Exportar */}
              <div className="space-y-2">
                {!origin && (
                  <p className="rounded-xl border border-dashed border-[#333029]/20 bg-white/70 px-3.5 py-3 text-center text-xs text-brand-taupe">
                    Informe seu ponto de partida acima para selecionar as filiais
                    mais próximas e liberar a navegação no Google Maps e Waze.
                  </p>
                )}
                {googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-yellow py-3.5 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                  >
                    Navegar no Waze / Google Maps ↗
                  </a>
                )}
                {wazeUrl && (
                  <a
                    href={wazeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center rounded-xl border border-[#333029]/15 bg-white py-2.5 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold"
                  >
                    Iniciar 1ª parada direto no Waze
                  </a>
                )}
              </div>
            </div>

            {/* Coluna direita: mapa */}
            <section
              aria-label="Mapa do trajeto"
              className="relative lg:sticky lg:top-24 lg:self-start"
            >
              <RouteMap
                origin={origin}
                stops={mapStops}
                routeCoordinates={routeCoordinates}
              />
              {origin && loadingMercados ? (
                <div className="absolute top-3 left-3 z-[1000] rounded-lg bg-brand-dark px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-yellow">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Buscando filiais próximas
                  </span>
                </div>
              ) : (
                routeLoading && (
                  <div className="absolute top-3 left-3 z-[1000] rounded-lg bg-brand-dark px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-yellow">
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Traçando trajeto
                    </span>
                  </div>
                )
              )}
              {!origin && (
                <p className="mt-2 text-xs text-brand-taupe">
                  Defina seu ponto de partida para identificar as filiais mais
                  próximas da sua cesta na Grande São Paulo e traçar a rota.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
