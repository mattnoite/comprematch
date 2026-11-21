"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  ExternalLink,
  Home,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  PiggyBank,
  Route as RouteIcon,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react";
import type { RouteMapOrigin, RouteMapStop } from "@/components/RouteMap";
import { useCart, type CartItem } from "@/hooks/useCart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-brand-taupe bg-[#faf7ef] text-brand-taupe sm:h-[480px] lg:h-[560px]">
      <Loader2
        className="h-6 w-6 animate-spin text-brand-gold"
        aria-hidden="true"
      />
      <span className="text-xs font-semibold">Carregando mapa interativo...</span>
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
  letter: string;
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
      // Busca exata de menor percurso aberto para até 7 lojas
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
      // Heurística do vizinho mais próximo para listas grandes
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
    letter: String.fromCharCode(66 + index), // B, C, D...
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

  // Enriquecimento opcional de preco_normal caso itens antigos do localStorage não tenham esse campo
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
        letter: stop.letter,
      })),
    [orderedStops]
  );

  const totalFinalCompras = getCartTotal();
  const totalItemCount = getItemCount();

  const economiaTotalBruta = useMemo(() => {
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

  // Cálculo da rota no OSRM sempre que houver origem + mercados
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
              ? `Não foi possível calcular a rota viária no OSRM: ${err.message}`
              : "Erro ao consultar o serviço de rotas OSRM.",
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
        "Geolocalização não suportada neste navegador. Informe seu CEP ou endereço."
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
          label: "Minha localização atual (GPS)",
        });
        setLocatingGps(false);
      },
      (geoErr) => {
        setLocatingGps(false);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          setOriginError(
            "Permissão de localização negada. Digite seu CEP ou endereço abaixo."
          );
        } else {
          setOriginError(
            "Não foi possível obter sua localização atual. Tente digitar seu CEP ou endereço."
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
    <div className="flex min-h-screen flex-col bg-[#fcfaf5] text-brand-dark">
      {/* Navbar superior */}
      <header className="sticky top-0 z-30 border-b border-brand-taupe/25 bg-brand-dark text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-taupe px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-taupe/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Voltar à Vitrine
            </Link>

            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-yellow text-brand-dark">
                <RouteIcon className="h-4 w-4" aria-hidden="true" />
              </div>
              <span className="text-sm font-bold tracking-tight text-white">
                CompreMatch · Roteirização Multiloja
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-olive/35 px-3 py-1 text-brand-yellow">
              <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
              {totalItemCount} {totalItemCount === 1 ? "item" : "itens"} ·{" "}
              {marketBuckets.length}{" "}
              {marketBuckets.length === 1 ? "mercado" : "mercados"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {!hydrated ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-2xl border border-brand-taupe/25 bg-white p-8">
            <Loader2
              className="h-7 w-7 animate-spin text-brand-gold"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-brand-taupe">
              Carregando seu carrinho...
            </p>
          </div>
        ) : items.length === 0 ? (
          <section className="mx-auto flex max-w-lg flex-col items-center justify-center rounded-2xl border border-brand-taupe bg-white px-6 py-16 text-center shadow-2xs">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-yellow/25 text-brand-dark">
              <ShoppingBag className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-5 text-xl font-extrabold text-brand-dark">
              Seu carrinho está vazio
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-brand-taupe">
              Adicione ofertas ao carrinho para traçar sua rota
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-yellow px-5 py-3 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar para a Vitrine de Ofertas
            </Link>
          </section>
        ) : (
          <div className="space-y-6">
            {/* Bloco de Entrada da Origem do Usuário */}
            <section
              aria-label="Ponto de partida"
              className="overflow-hidden rounded-2xl border border-brand-taupe bg-white shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-dark px-5 py-3.5 text-white">
                <div className="flex items-center gap-2">
                  <Home
                    className="h-4 w-4 text-brand-yellow"
                    aria-hidden="true"
                  />
                  <h1 className="text-sm font-bold uppercase tracking-wider">
                    Ponto A · Origem da sua Rota
                  </h1>
                </div>
                {origin && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-yellow/20 px-2.5 py-0.5 text-xs font-semibold text-brand-yellow">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    Origem definida
                  </span>
                )}
              </div>

              <div className="space-y-4 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <button
                    id="use-gps-btn"
                    type="button"
                    onClick={handleUseCurrentLocation}
                    disabled={locatingGps}
                    className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {locatingGps ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        Obtendo GPS...
                      </>
                    ) : (
                      <>
                        <LocateFixed className="h-4 w-4" aria-hidden="true" />
                        Usar minha localização atual
                      </>
                    )}
                  </button>

                  <span className="hidden text-xs font-semibold uppercase text-brand-taupe lg:inline">
                    ou
                  </span>

                  <form
                    onSubmit={(e) => void handleSearchAddress(e)}
                    className="flex flex-1 flex-col gap-2 sm:flex-row"
                  >
                    <label htmlFor="origin-address-input" className="sr-only">
                      CEP ou endereço de saída
                    </label>
                    <div className="relative flex-1">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-brand-olive"
                        aria-hidden="true"
                      />
                      <input
                        id="origin-address-input"
                        type="text"
                        value={addressQuery}
                        onChange={(e) => setAddressQuery(e.target.value)}
                        placeholder="Digite seu CEP (ex: 04012-000) ou endereço de saída..."
                        className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-3.5 pl-10 text-sm font-medium text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                      />
                    </div>
                    <button
                      id="search-address-btn"
                      type="submit"
                      disabled={geocoding}
                      className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-brand-taupe bg-[#faf7ef] px-4 py-2.5 text-sm font-bold text-brand-dark transition-colors hover:border-brand-gold hover:bg-brand-yellow/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {geocoding ? (
                        <>
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                          Buscando...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4" aria-hidden="true" />
                          Buscar Endereço
                        </>
                      )}
                    </button>
                  </form>
                </div>

                {origin && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-gold/50 bg-brand-yellow/10 px-4 py-2.5 text-xs">
                    <span className="font-semibold text-brand-dark">
                      Partindo de:{" "}
                      <strong className="font-bold">{origin.label}</strong>
                    </span>
                    <span className="font-mono text-[11px] text-brand-taupe">
                      {origin.lat.toFixed(5)}, {origin.lng.toFixed(5)}
                    </span>
                  </div>
                )}

                {originError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{originError}</span>
                  </div>
                )}

                {routeError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2.5 text-xs font-medium text-brand-dark"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    <span>{routeError}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Mapa Interativo + Painel de Resumo da Jornada */}
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Coluna do Mapa */}
              <section
                aria-label="Mapa da rota"
                className="space-y-3 lg:col-span-7"
              >
                <div className="relative">
                  <RouteMap
                    origin={origin}
                    stops={mapStops}
                    routeCoordinates={routeCoordinates}
                  />

                  {routeLoading && (
                    <div className="absolute top-4 right-4 z-[1000] inline-flex items-center gap-2 rounded-xl border border-brand-gold bg-brand-dark px-3.5 py-2 text-xs font-bold text-brand-yellow shadow-lg">
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                      Calculando rota no OSRM...
                    </div>
                  )}
                </div>

                {!origin && (
                  <p className="rounded-xl border border-brand-taupe/30 bg-white px-4 py-2.5 text-xs text-brand-taupe">
                    Os mercados do seu carrinho já estão marcados no mapa. Defina
                    seu ponto de partida acima para traçar a rota viária
                    completa.
                  </p>
                )}
              </section>

              {/* Painel de Resumo da Jornada */}
              <aside
                aria-label="Resumo da jornada de compras"
                className="space-y-5 lg:col-span-5"
              >
                {/* Card de Métricas */}
                <section className="overflow-hidden rounded-2xl border border-brand-taupe bg-white shadow-2xs">
                  <div className="bg-brand-dark px-5 py-3.5 text-white">
                    <h2 className="text-sm font-bold uppercase tracking-wider">
                      Resumo da Jornada
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4">
                    <div className="rounded-xl border border-brand-taupe/25 bg-[#faf7ef] p-3.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-taupe">
                        <RouteIcon
                          className="h-3.5 w-3.5 text-brand-olive"
                          aria-hidden="true"
                        />
                        Distância Total
                      </span>
                      <p className="mt-1.5 text-xl font-extrabold text-brand-dark">
                        {totalDistanceMeters !== null
                          ? formatDistanceKm(totalDistanceMeters)
                          : "—"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-brand-taupe/25 bg-[#faf7ef] p-3.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-taupe">
                        <Clock
                          className="h-3.5 w-3.5 text-brand-olive"
                          aria-hidden="true"
                        />
                        Tempo Estimado
                      </span>
                      <p className="mt-1.5 text-xl font-extrabold text-brand-dark">
                        {totalDurationSeconds !== null
                          ? formatDuration(totalDurationSeconds)
                          : "—"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-brand-gold/50 bg-brand-yellow/15 p-3.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-taupe">
                        <PiggyBank
                          className="h-3.5 w-3.5 text-brand-olive"
                          aria-hidden="true"
                        />
                        Economia Bruta
                      </span>
                      <p className="mt-1.5 text-xl font-extrabold text-brand-dark">
                        {formatBRL(economiaTotalBruta)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-brand-dark bg-brand-dark p-3.5 text-white">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-yellow">
                        <ShoppingBag
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Valor Final
                      </span>
                      <p className="mt-1.5 text-xl font-extrabold text-white">
                        {formatBRL(totalFinalCompras)}
                      </p>
                    </div>
                  </div>
                </section>

                {/* Sequência de Paradas Sugeridas */}
                <section className="overflow-hidden rounded-2xl border border-brand-taupe bg-white shadow-2xs">
                  <div className="flex items-center justify-between border-b border-brand-taupe/25 bg-[#faf7ef] px-5 py-3">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-brand-dark">
                      Sequência de Paradas Sugeridas
                    </h2>
                    <span className="rounded-full bg-brand-yellow px-2.5 py-0.5 text-[11px] font-bold text-brand-dark">
                      {orderedStops.length}{" "}
                      {orderedStops.length === 1 ? "parada" : "paradas"}
                    </span>
                  </div>

                  <ol className="divide-y divide-brand-taupe/20">
                    {origin && (
                      <li className="flex items-start gap-3 px-5 py-3.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-yellow bg-brand-dark text-xs font-extrabold text-brand-yellow">
                          A
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-brand-dark">
                            Saída · Sua Origem
                          </p>
                          <p className="truncate text-[11px] text-brand-taupe">
                            {origin.label}
                          </p>
                        </div>
                      </li>
                    )}

                    {orderedStops.map((stop, idx) => {
                      const leg = routeLegs[idx];
                      return (
                        <li
                          key={stop.mercado_id}
                          className="space-y-2 px-5 py-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-yellow text-xs font-black text-brand-dark">
                                {stop.letter}
                              </span>
                              <div className="min-w-0">
                                <p className="flex items-center gap-1.5 text-sm font-bold text-brand-dark">
                                  <Store
                                    className="h-3.5 w-3.5 shrink-0 text-brand-olive"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">
                                    {stop.nome_rede}
                                  </span>
                                </p>
                                <p className="text-xs text-brand-taupe">
                                  {stop.unidade}
                                </p>
                                {leg && (
                                  <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-brand-yellow/15 px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
                                    <Navigation
                                      className="h-3 w-3 text-brand-olive"
                                      aria-hidden="true"
                                    />
                                    Trecho: {formatDistanceKm(leg.distance)} ·{" "}
                                    {formatDuration(leg.duration)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-[11px] font-medium text-brand-taupe">
                                Subtotal
                              </p>
                              <p className="text-sm font-extrabold text-brand-dark">
                                {formatBRL(stop.subtotal)}
                              </p>
                            </div>
                          </div>

                          <ul className="ml-10 space-y-1 rounded-xl border border-brand-taupe/20 bg-[#fcfaf5] px-3 py-2 text-xs">
                            {stop.items.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2 text-brand-dark"
                              >
                                <span className="truncate">
                                  <strong className="font-semibold">
                                    {item.quantity}x
                                  </strong>{" "}
                                  {item.produto_nome}
                                </span>
                                <span className="shrink-0 font-semibold text-brand-taupe">
                                  {formatBRL(item.preco_oferta * item.quantity)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ol>

                  {/* Botões externos Google Maps / Waze */}
                  <div className="space-y-2.5 border-t border-brand-taupe/25 bg-[#faf7ef] p-4">
                    {googleMapsUrl && (
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-3 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold"
                      >
                        <Navigation className="h-4 w-4" aria-hidden="true" />
                        Abrir Rota no Google Maps / Waze
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}

                    {wazeUrl && (
                      <a
                        href={wazeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-taupe bg-white px-4 py-2 text-xs font-bold text-brand-dark transition-colors hover:border-brand-gold hover:bg-brand-yellow/15"
                      >
                        Iniciar 1ª parada direto no Waze
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
