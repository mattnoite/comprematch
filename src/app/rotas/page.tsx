"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Loader2,
  LocateFixed,
  Navigation,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react";
import type { RouteMapOrigin, RouteMapStop } from "@/components/RouteMap";
import { useCart, type CartItem } from "@/hooks/useCart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

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

interface MarketBucket {
  mercado_id: string;
  nome_rede: string;
  unidade: string;
  lat: number;
  lng: number;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
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

  const marketBuckets = useMemo<MarketBucket[]>(() => {
    const map = new Map<string, MarketBucket>();

    for (const item of items) {
      const existing = map.get(item.mercado_id);
      if (existing) {
        existing.items.push(item);
        existing.itemCount += item.quantity;
        existing.subtotal += item.preco_oferta * item.quantity;
      } else {
        map.set(item.mercado_id, {
          mercado_id: item.mercado_id,
          nome_rede: item.nome_rede,
          unidade: item.unidade,
          lat: item.lat,
          lng: item.lng,
          items: [item],
          itemCount: item.quantity,
          subtotal: item.preco_oferta * item.quantity,
        });
      }
    }

    return Array.from(map.values());
  }, [items]);

  const orderedStops = useMemo<OrderedStop[]>(
    () => orderMarketsFromOrigin(marketBuckets, origin),
    [marketBuckets, origin]
  );

  const mapStops = useMemo<RouteMapStop[]>(
    () =>
      orderedStops.map((stop) => ({
        mercado_id: stop.mercado_id,
        nome_rede: stop.nome_rede,
        unidade: stop.unidade,
        lat: stop.lat,
        lng: stop.lng,
        subtotal: stop.subtotal,
        itemCount: stop.itemCount,
        stopNumber: stop.stopNumber,
      })),
    [orderedStops]
  );

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
      {/* Navbar compacta e fosca */}
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#333029]/10 bg-white px-3 py-1.5 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Ofertas
            </Link>
            <span className="flex items-center gap-1.5">
              <span className="text-lg font-extrabold tracking-tighter text-brand-dark">
                CompreMatch
              </span>
              <span
                aria-hidden="true"
                className="mt-1 h-2 w-2 rounded-full bg-brand-yellow"
              />
            </span>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border border-[#333029]/10 bg-white py-1.5 pr-1.5 pl-3 text-xs font-bold text-brand-dark">
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
            <span className={`hidden sm:inline ${NUM}`}>
              {formatBRL(totalFinalCompras)}
            </span>
            <span className="rounded-full bg-brand-dark px-2 py-0.5 font-mono text-xs font-bold text-brand-yellow tabular-nums">
              {totalItemCount}
            </span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
        {!hydrated ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-[#333029]/10 bg-white p-8">
            <Loader2
              className="h-6 w-6 animate-spin text-brand-gold"
              aria-hidden="true"
            />
            <p className={MICRO_LABEL}>Carregando sua cesta</p>
          </div>
        ) : items.length === 0 ? (
          <section className="mx-auto flex max-w-md flex-col items-center justify-center rounded-xl border border-[#333029]/10 bg-white px-6 py-14 text-center">
            <ShoppingBag
              className="h-7 w-7 text-brand-olive"
              aria-hidden="true"
            />
            <h1 className="mt-3 text-base font-extrabold tracking-tight text-brand-dark">
              Sua cesta está vazia
            </h1>
            <p className="mt-1 text-sm text-brand-taupe">
              Adicione ofertas ao carrinho para traçar sua rota
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-yellow px-4 py-2.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Voltar para as ofertas
            </Link>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12">
            <h1 className="sr-only">Rota econômica das suas compras</h1>

            {/* Painel lateral */}
            <aside
              aria-label="Painel da rota"
              className="space-y-3 lg:col-span-4"
            >
              {/* Origem */}
              <section
                aria-label="Ponto de partida"
                className="rounded-xl border border-[#333029]/10 bg-[#F3F1EC] p-3"
              >
                <p className={MICRO_LABEL}>Ponto de partida</p>

                <button
                  id="use-gps-btn"
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={locatingGps}
                  className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-yellow py-2.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {locatingGps ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Localizando…
                    </>
                  ) : (
                    <>
                      <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
                      Usar minha localização atual
                    </>
                  )}
                </button>

                <form
                  onSubmit={(e) => void handleSearchAddress(e)}
                  className="mt-2 flex gap-1.5"
                >
                  <label htmlFor="origin-address-input" className="sr-only">
                    CEP ou endereço de saída
                  </label>
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-brand-olive"
                      aria-hidden="true"
                    />
                    <input
                      id="origin-address-input"
                      type="text"
                      value={addressQuery}
                      onChange={(e) => setAddressQuery(e.target.value)}
                      placeholder="CEP ou endereço"
                      className="w-full rounded-lg border border-[#333029]/10 bg-white py-2 pr-2.5 pl-8 text-xs font-medium text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:outline-none"
                    />
                  </div>
                  <button
                    id="search-address-btn"
                    type="submit"
                    disabled={geocoding}
                    className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/10 bg-white px-3 py-2 text-xs font-bold text-brand-dark transition-colors hover:border-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {geocoding ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      "Buscar"
                    )}
                  </button>
                </form>

                {originError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{originError}</span>
                  </div>
                )}

                {routeError && (
                  <div
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-brand-gold/50 bg-brand-yellow/10 px-2.5 py-2 text-xs font-medium text-brand-dark"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-gold"
                      aria-hidden="true"
                    />
                    <span>{routeError}</span>
                  </div>
                )}
              </section>

              {/* KPIs */}
              <section
                aria-label="Indicadores da rota"
                className="grid grid-cols-3 gap-2"
              >
                <div className="rounded-xl border border-[#333029]/10 bg-white p-3">
                  <p className={MICRO_LABEL}>Paradas</p>
                  <p
                    className={`mt-1 text-lg font-black text-brand-dark ${NUM}`}
                  >
                    {orderedStops.length}
                    <span className="ml-1 text-xs font-bold text-brand-taupe">
                      {orderedStops.length === 1 ? "loja" : "lojas"}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-[#333029]/10 bg-white p-3">
                  <p className={MICRO_LABEL}>Trajeto</p>
                  <p
                    className={`mt-1 text-lg font-black text-brand-dark ${NUM}`}
                  >
                    {totalDistanceMeters !== null
                      ? formatDistanceKm(totalDistanceMeters)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-[#333029]/10 bg-white p-3">
                  <p className={MICRO_LABEL}>Tempo</p>
                  <p
                    className={`mt-1 text-lg font-black text-brand-dark ${NUM}`}
                  >
                    {totalDurationSeconds !== null
                      ? `~${formatDuration(totalDurationSeconds)}`
                      : "—"}
                  </p>
                </div>
              </section>

              <div className="flex items-baseline justify-between rounded-xl border border-[#333029]/10 bg-white px-3 py-2.5">
                <span className={MICRO_LABEL}>Economia identificada</span>
                <span className={`text-sm font-black text-brand-dark ${NUM}`}>
                  {formatBRL(economiaLiquida)}
                </span>
              </div>

              {/* Stepper vertical */}
              <section
                aria-label="Sequência de paradas"
                className="rounded-xl border border-[#333029]/10 bg-white p-4"
              >
                <p className={MICRO_LABEL}>Sequência de paradas</p>

                <ol className="mt-3">
                  <li className="relative flex gap-3 pb-5">
                    <span
                      aria-hidden="true"
                      className="absolute top-7 bottom-0 left-[13px] border-l-2 border-dotted border-[#333029]/30"
                    />
                    <span
                      className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-dark text-xs font-bold text-brand-yellow ${NUM}`}
                    >
                      0
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className={MICRO_LABEL}>Origem · Sua casa</p>
                      <p className="mt-0.5 text-xs font-semibold text-brand-dark">
                        {origin ? origin.label : "Defina seu ponto de partida"}
                      </p>
                    </div>
                  </li>

                  {orderedStops.map((stop, idx) => {
                    const leg = routeLegs[idx];
                    const isLast = idx === orderedStops.length - 1;

                    return (
                      <li
                        key={stop.mercado_id}
                        className={`relative flex gap-3 ${isLast ? "" : "pb-5"}`}
                      >
                        {!isLast && (
                          <span
                            aria-hidden="true"
                            className="absolute top-7 bottom-0 left-[13px] border-l-2 border-dotted border-[#333029]/30"
                          />
                        )}
                        <span
                          className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-yellow text-xs font-black text-brand-dark ${NUM}`}
                        >
                          {stop.stopNumber}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 text-xs font-bold text-brand-dark">
                                <Store
                                  className="h-3.5 w-3.5 shrink-0 text-brand-olive"
                                  aria-hidden="true"
                                />
                                <span className="truncate">
                                  {stop.nome_rede}
                                </span>
                              </p>
                              <p className="text-[11px] text-brand-taupe">
                                {stop.unidade}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 text-xs font-bold text-brand-dark ${NUM}`}
                            >
                              {formatBRL(stop.subtotal)}
                            </span>
                          </div>

                          {leg && (
                            <p
                              className={`mt-1 text-[10px] font-bold uppercase tracking-widest text-brand-taupe ${NUM}`}
                            >
                              {formatDistanceKm(leg.distance)} ·{" "}
                              {formatDuration(leg.duration)}
                            </p>
                          )}

                          <ul className="mt-1.5 space-y-0.5 text-[11px] text-brand-taupe">
                            {stop.items.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2"
                              >
                                <span className="truncate">
                                  <span className={`font-bold ${NUM}`}>
                                    {item.quantity}×
                                  </span>{" "}
                                  {item.produto_nome}
                                </span>
                                <span className={`shrink-0 ${NUM}`}>
                                  {formatBRL(
                                    item.preco_oferta * item.quantity
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>

              {/* Exportar rota */}
              <div className="space-y-2">
                {googleMapsUrl && (
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-yellow py-3 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
                  >
                    <Navigation className="h-4 w-4" aria-hidden="true" />
                    Abrir Trajeto no Google Maps / Waze
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
                {wazeUrl && (
                  <a
                    href={wazeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#333029]/10 bg-white py-2 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold"
                  >
                    Iniciar 1ª parada no Waze
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </aside>

            {/* Janela do mapa */}
            <section
              aria-label="Mapa do trajeto"
              className="relative lg:sticky lg:top-20 lg:col-span-8 lg:self-start"
            >
              <RouteMap
                origin={origin}
                stops={mapStops}
                routeCoordinates={routeCoordinates}
              />

              {routeLoading && (
                <div
                  className={`absolute top-3 left-3 z-[1000] rounded-lg bg-brand-dark px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-yellow`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2
                      className="h-3 w-3 animate-spin"
                      aria-hidden="true"
                    />
                    Traçando trajeto
                  </span>
                </div>
              )}

              {!origin && (
                <p className="mt-2 text-xs text-brand-taupe">
                  Mercados da cesta já marcados no mapa. Defina o ponto de
                  partida para traçar a rota completa.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
