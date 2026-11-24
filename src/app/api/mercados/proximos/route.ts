import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeChainKey } from "@/lib/chains";
import { haversineMeters } from "@/lib/geo";

export interface NearbyBranchResult {
  chainKey: string;
  nome_rede: string;
  unidade: string;
  endereco: string;
  lat: number;
  lng: number;
  distancia_metros: number;
  fonte: "google_places" | "overpass" | "photon" | "nominatim" | "supabase";
}

interface RequestBody {
  origin?: {
    lat?: unknown;
    lng?: unknown;
  };
  redes?: unknown;
}

interface NormalizedChainRequest {
  chainKey: string;
  nome_rede: string;
  aliases: string[];
  searchQueries: string[];
}

interface CandidatePlace {
  name: string;
  brand: string;
  unidade: string;
  endereco: string;
  lat: number;
  lng: number;
  fonte: "google_places" | "overpass" | "photon" | "nominatim" | "supabase";
}

const KNOWN_CHAIN_ALIASES: Record<string, string[]> = {
  "assai atacadista": ["assai atacadista", "assai"],
  assai: ["assai atacadista", "assai"],
  "carrefour bairro": ["carrefour bairro", "carrefour market", "carrefour"],
  "carrefour hipermercado": ["carrefour hipermercado", "carrefour"],
  "carrefour express": ["carrefour express", "carrefour"],
  carrefour: [
    "carrefour",
    "carrefour bairro",
    "carrefour market",
    "carrefour express",
  ],
  "pao de acucar": ["pao de acucar", "minuto pao de acucar"],
  "minuto pao de acucar": ["minuto pao de acucar", "pao de acucar"],
  "extra mercado": ["extra mercado", "mercado extra", "extra"],
  "mercado extra": ["mercado extra", "extra mercado", "extra"],
  extra: ["extra mercado", "mercado extra", "extra"],
  atacadao: ["atacadao"],
  "tenda atacado": ["tenda atacado", "tenda"],
  "roldao atacadista": ["roldao atacadista", "roldao"],
  "sonda supermercados": ["sonda supermercados", "sonda"],
  sonda: ["sonda supermercados", "sonda"],
  hirota: ["hirota", "hirota food", "supermercado hirota"],
  "hirota food": ["hirota food", "hirota", "supermercado hirota"],
  dia: ["supermercado dia", "dia%", "dia"],
  "supermercado dia": ["supermercado dia", "dia%", "dia"],
  "st marche": ["st marche", "santa marche"],
  "sams club": ["sam's club", "sams club"],
  "sam's club": ["sam's club", "sams club"],
  mambo: ["mambo", "supermercados mambo"],
  "lopes supermercados": [
    "lopes supermercados",
    "supermercados lopes",
    "lopes",
  ],
  nagumo: ["nagumo", "supermercados nagumo"],
  "barbosa supermercados": ["barbosa supermercados", "barbosa"],
  swift: ["swift", "mercado swift"],
  oxxo: ["oxxo"],
  "akki atacadista": ["akki atacadista", "akki"],
};

const SEARCH_QUERY_OVERRIDES: Record<string, string[]> = {
  dia: ["Supermercado Dia", "Dia%"],
  extra: ["Mercado Extra", "Extra Mercado"],
  sonda: ["Sonda Supermercados"],
  hirota: ["Hirota Supermercado", "Hirota Food"],
  swift: ["Swift Mercado"],
  tenda: ["Tenda Atacado"],
  roldao: ["Roldão Atacadista"],
  lopes: ["Supermercados Lopes"],
  nagumo: ["Supermercados Nagumo"],
};

const GENERIC_CHAIN_WORDS = new Set([
  "supermercado",
  "supermercados",
  "hipermercado",
  "hipermercados",
  "atacadista",
  "atacado",
  "mercado",
  "mercados",
  "express",
  "bairro",
  "market",
  "loja",
  "lojas",
  "food",
]);

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const OVERPASS_RADII_METERS = [5000, 12000, 25000] as const;
const MAX_ACCEPTED_DISTANCE_METERS = 45_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

const branchCache = new Map<
  string,
  { value: NearbyBranchResult; expiresAt: number }
>();

function makeCacheKey(origin: { lat: number; lng: number }, chainKey: string) {
  // Grade ~1,1 km para reaproveitar buscas próximas sem estourar limites externos
  return `${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}::${chainKey}`;
}

function getCachedBranch(
  origin: { lat: number; lng: number },
  chainKey: string
): NearbyBranchResult | null {
  const key = makeCacheKey(origin, chainKey);
  const entry = branchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    branchCache.delete(key);
    return null;
  }
  // Recalcula distância exata para a origem atual
  const exactDistance = Math.round(
    haversineMeters(origin.lat, origin.lng, entry.value.lat, entry.value.lng)
  );
  return { ...entry.value, distancia_metros: exactDistance };
}

function setCachedBranch(
  origin: { lat: number; lng: number },
  chainKey: string,
  value: NearbyBranchResult
): void {
  if (branchCache.size >= 400) {
    const oldest = branchCache.keys().next().value;
    if (oldest) branchCache.delete(oldest);
  }
  branchCache.set(makeCacheKey(origin, chainKey), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toAccentInsensitiveRegex(normalizedAscii: string): string {
  const charMap: Record<string, string> = {
    a: "[aáàâãä]",
    e: "[eéèêë]",
    i: "[iíìîï]",
    o: "[oóòôõö]",
    u: "[uúùûü]",
    c: "[cç]",
  };
  return Array.from(normalizedAscii)
    .map((ch) => charMap[ch] ?? escapeRegex(ch))
    .join("");
}

function buildChainRequest(nomeRede: string): NormalizedChainRequest {
  const clean = nomeRede.trim().replace(/\s+/g, " ");
  const key = normalizeChainKey(clean);
  const aliasSet = new Set<string>([key]);

  const known = KNOWN_CHAIN_ALIASES[key];
  if (known) {
    for (const a of known) aliasSet.add(normalizeChainKey(a));
  }

  const coreTokens = key
    .split(" ")
    .filter((token) => token.length > 0 && !GENERIC_CHAIN_WORDS.has(token));
  const corePhrase = coreTokens.join(" ").trim();
  if (corePhrase.length >= 3) {
    aliasSet.add(corePhrase);
  }

  const aliases = Array.from(aliasSet).filter((a) => a.length >= 2);
  aliases.sort((a, b) => b.length - a.length);

  const overrideQueries = SEARCH_QUERY_OVERRIDES[key];
  const searchQueries = overrideQueries
    ? [...overrideQueries, clean]
    : [clean];

  return {
    chainKey: key,
    nome_rede: clean,
    aliases,
    searchQueries: Array.from(new Set(searchQueries)),
  };
}

function candidateMatchScore(
  candidate: { name: string; brand: string },
  target: NormalizedChainRequest
): number {
  const normName = normalizeChainKey(candidate.name);
  const normBrand = normalizeChainKey(candidate.brand);
  const fields = [normName, normBrand].filter(Boolean);
  if (fields.length === 0) return 0;

  let bestScore = 0;

  for (let i = 0; i < target.aliases.length; i++) {
    const alias = target.aliases[i];
    const boundaryRegex = new RegExp(
      `(^|\\s|-|/)${escapeRegex(alias)}(\\s|-|%|$)`
    );

    for (const field of fields) {
      if (field === alias) {
        bestScore = Math.max(bestScore, i === 0 ? 100 : 90);
      } else if (boundaryRegex.test(field)) {
        bestScore = Math.max(bestScore, i === 0 ? 80 : 65);
      }
    }
  }

  return bestScore;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

interface GooglePlaceItem {
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

async function searchGooglePlaces(
  origin: { lat: number; lng: number },
  target: NormalizedChainRequest,
  apiKey: string
): Promise<CandidatePlace[]> {
  try {
    const response = await fetchWithTimeout(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location",
        },
        body: JSON.stringify({
          textQuery: target.searchQueries[0],
          languageCode: "pt-BR",
          regionCode: "BR",
          rankPreference: "DISTANCE",
          maxResultCount: 6,
          locationBias: {
            circle: {
              center: { latitude: origin.lat, longitude: origin.lng },
              radius: 20000,
            },
          },
        }),
      },
      5000
    );

    if (!response.ok) return [];
    const data = (await response.json()) as { places?: GooglePlaceItem[] };
    const places = Array.isArray(data.places) ? data.places : [];

    return places.flatMap((place) => {
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (
        typeof lat !== "number" ||
        !Number.isFinite(lat) ||
        typeof lng !== "number" ||
        !Number.isFinite(lng)
      ) {
        return [];
      }

      const name = place.displayName?.text?.trim() || target.nome_rede;
      const fullAddr =
        place.shortFormattedAddress?.trim() ||
        place.formattedAddress?.trim() ||
        "";
      const addrParts = fullAddr
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const unidade =
        addrParts[1] ||
        name
          .replace(new RegExp(escapeRegex(target.nome_rede), "i"), "")
          .trim() ||
        "Unidade próxima";

      return [
        {
          name,
          brand: name,
          unidade,
          endereco: fullAddr,
          lat,
          lng,
          fonte: "google_places" as const,
        },
      ];
    });
  } catch {
    return [];
  }
}

interface OverpassElement {
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface OverpassSearchResult {
  candidates: CandidatePlace[];
  reachable: boolean;
}

async function searchOverpassRadius(
  origin: { lat: number; lng: number },
  targets: NormalizedChainRequest[],
  radiusMeters: number
): Promise<OverpassSearchResult> {
  const regexTerms = Array.from(
    new Set(
      targets.flatMap((t) =>
        t.aliases
          .filter((a) => a.length >= 3)
          .slice(0, 3)
          .map(toAccentInsensitiveRegex)
      )
    )
  );

  if (regexTerms.length === 0) return { candidates: [], reachable: true };
  const combinedRegex = regexTerms.join("|");

  const query = `[out:json][timeout:4];
(
  nw["shop"~"supermarket|wholesale"]["name"~"${combinedRegex}",i](around:${radiusMeters},${origin.lat},${origin.lng});
  nw["shop"~"supermarket|wholesale"]["brand"~"${combinedRegex}",i](around:${radiusMeters},${origin.lat},${origin.lng});
);
out center tags;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "CompreMatch/1.0 (https://comprematch.local)",
          },
          body: `data=${encodeURIComponent(query)}`,
        },
        3000
      );

      if (!response.ok) continue;
      const data = (await response.json()) as { elements?: OverpassElement[] };
      const elements = Array.isArray(data.elements) ? data.elements : [];

      const candidates = elements.flatMap((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (
          typeof lat !== "number" ||
          !Number.isFinite(lat) ||
          typeof lng !== "number" ||
          !Number.isFinite(lng)
        ) {
          return [];
        }

        const tags = el.tags ?? {};
        const name = (tags.name ?? tags.brand ?? "").trim();
        const brand = (tags.brand ?? tags.operator ?? "").trim();
        if (!name && !brand) return [];

        const street = tags["addr:street"]?.trim();
        const houseNumber = tags["addr:housenumber"]?.trim();
        const suburb =
          tags["addr:suburb"]?.trim() ||
          tags["addr:neighbourhood"]?.trim() ||
          tags["addr:district"]?.trim();
        const city = tags["addr:city"]?.trim();
        const branchTag = tags.branch?.trim();

        const streetLine =
          street && houseNumber ? `${street}, ${houseNumber}` : street;
        const endereco = [streetLine, suburb, city].filter(Boolean).join(" - ");
        const unidade =
          branchTag || suburb || street || city || "Unidade próxima";

        return [
          {
            name,
            brand,
            unidade,
            endereco,
            lat,
            lng,
            fonte: "overpass" as const,
          },
        ];
      });

      return { candidates, reachable: true };
    } catch {
      continue;
    }
  }

  return { candidates: [], reachable: false };
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    state?: string;
    countrycode?: string;
  };
}

const VALID_STORE_OSM_VALUES = new Set([
  "supermarket",
  "wholesale",
  "convenience",
  "department_store",
  "general",
  "mall",
  "greengrocer",
  "butcher",
  "marketplace",
]);

async function searchPhoton(
  origin: { lat: number; lng: number },
  target: NormalizedChainRequest
): Promise<CandidatePlace[]> {
  const results: CandidatePlace[] = [];

  for (const queryText of target.searchQueries.slice(0, 2)) {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", queryText);
    url.searchParams.set("lat", String(origin.lat));
    url.searchParams.set("lon", String(origin.lng));
    url.searchParams.set("limit", "15");
    url.searchParams.set("osm_tag", "shop");

    try {
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            "User-Agent": "CompreMatch/1.0 (https://comprematch.local)",
          },
        },
        4500
      );

      if (!response.ok) continue;
      const data = (await response.json()) as { features?: PhotonFeature[] };
      const features = Array.isArray(data.features) ? data.features : [];

      for (const feature of features) {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        const [lng, lat] = coords;
        if (
          typeof lat !== "number" ||
          !Number.isFinite(lat) ||
          typeof lng !== "number" ||
          !Number.isFinite(lng)
        ) {
          continue;
        }

        const props = feature.properties ?? {};
        if (
          props.countrycode &&
          props.countrycode.toUpperCase() !== "BR"
        ) {
          continue;
        }
        if (
          props.osm_value &&
          !VALID_STORE_OSM_VALUES.has(props.osm_value.toLowerCase())
        ) {
          continue;
        }

        const dist = haversineMeters(origin.lat, origin.lng, lat, lng);
        if (dist > MAX_ACCEPTED_DISTANCE_METERS) continue;

        const name = (props.name ?? "").trim();
        if (!name) continue;

        const streetLine =
          props.street && props.housenumber
            ? `${props.street}, ${props.housenumber}`
            : props.street;
        const suburb = props.district || props.locality || "";
        const city = props.city || "";
        const endereco = [streetLine, suburb, city]
          .filter(Boolean)
          .join(" - ");
        const unidade = suburb || props.street || city || "Unidade próxima";

        results.push({
          name,
          brand: name,
          unidade,
          endereco,
          lat,
          lng,
          fonte: "photon",
        });
      }

      if (results.some((c) => candidateMatchScore(c, target) > 0)) {
        return results;
      }
    } catch {
      continue;
    }
  }

  return results;
}

interface NominatimItem {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    city?: string;
    town?: string;
    municipality?: string;
  };
}

const NOMINATIM_BOX_DELTAS = [
  { latDelta: 0.09, lngDelta: 0.1, limit: "20" }, // ~10 km
  { latDelta: 0.28, lngDelta: 0.32, limit: "25" }, // ~30 km (Grande SP)
] as const;

let lastNominatimCallAt = 0;

async function throttleNominatim(): Promise<void> {
  const elapsed = Date.now() - lastNominatimCallAt;
  if (elapsed < 1050) {
    await new Promise((resolve) => setTimeout(resolve, 1050 - elapsed));
  }
  lastNominatimCallAt = Date.now();
}

async function searchNominatimFallback(
  origin: { lat: number; lng: number },
  target: NormalizedChainRequest
): Promise<CandidatePlace[]> {
  for (const box of NOMINATIM_BOX_DELTAS) {
    await throttleNominatim();

    const viewbox = [
      (origin.lng - box.lngDelta).toFixed(5),
      (origin.lat + box.latDelta).toFixed(5),
      (origin.lng + box.lngDelta).toFixed(5),
      (origin.lat - box.latDelta).toFixed(5),
    ].join(",");

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", box.limit);
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("viewbox", viewbox);
    url.searchParams.set("bounded", "1");
    url.searchParams.set("q", target.searchQueries[0]);

    try {
      const response = await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            "User-Agent": "CompreMatch/1.0 (https://comprematch.local)",
            "Accept-Language": "pt-BR,pt;q=0.9",
          },
        },
        4500
      );

      if (!response.ok) continue;
      const data = (await response.json()) as unknown;
      if (!Array.isArray(data) || data.length === 0) continue;

      const parsed = (data as NominatimItem[]).flatMap((item) => {
        const lat = Number.parseFloat(item.lat ?? "");
        const lng = Number.parseFloat(item.lon ?? "");
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

        const dist = haversineMeters(origin.lat, origin.lng, lat, lng);
        if (dist > MAX_ACCEPTED_DISTANCE_METERS) return [];

        const addr = item.address ?? {};
        const streetLine =
          addr.road && addr.house_number
            ? `${addr.road}, ${addr.house_number}`
            : addr.road;
        const suburb =
          addr.suburb || addr.neighbourhood || addr.city_district || "";
        const city = addr.city || addr.town || addr.municipality || "";
        const endereco =
          [streetLine, suburb, city].filter(Boolean).join(" - ") ||
          item.display_name ||
          "";
        const unidade = suburb || addr.road || city || "Unidade próxima";
        const name =
          item.name?.trim() || item.display_name?.split(",")[0]?.trim() || "";

        return [
          {
            name,
            brand: item.display_name ?? name,
            unidade,
            endereco,
            lat,
            lng,
            fonte: "nominatim" as const,
          },
        ];
      });

      if (parsed.some((c) => candidateMatchScore(c, target) > 0)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchSupabaseFallbackCandidates(): Promise<
  Array<{
    nome_rede: string;
    unidade: string;
    endereco: string;
    latitude: number;
    longitude: number;
  }>
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (
    !supabaseUrl ||
    !supabaseKey ||
    supabaseUrl.includes("your-project-id") ||
    supabaseKey.includes("your-supabase-anon-key")
  ) {
    return [];
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase
      .from("mercados")
      .select("nome_rede, unidade, endereco, latitude, longitude");

    if (error || !Array.isArray(data)) return [];
    return data as Array<{
      nome_rede: string;
      unidade: string;
      endereco: string;
      latitude: number;
      longitude: number;
    }>;
  } catch {
    return [];
  }
}

function pickClosestMatchingCandidate(
  origin: { lat: number; lng: number },
  target: NormalizedChainRequest,
  candidates: CandidatePlace[]
): NearbyBranchResult | null {
  let best: { result: NearbyBranchResult; score: number } | null = null;

  for (const candidate of candidates) {
    const score = candidateMatchScore(candidate, target);
    if (score === 0) continue;

    const distance = haversineMeters(
      origin.lat,
      origin.lng,
      candidate.lat,
      candidate.lng
    );

    if (
      !best ||
      distance < best.result.distancia_metros - 250 ||
      (Math.abs(distance - best.result.distancia_metros) <= 250 &&
        score > best.score)
    ) {
      best = {
        score,
        result: {
          chainKey: target.chainKey,
          nome_rede: target.nome_rede,
          unidade: candidate.unidade,
          endereco: candidate.endereco,
          lat: candidate.lat,
          lng: candidate.lng,
          distancia_metros: Math.round(distance),
          fonte: candidate.fonte,
        },
      };
    }
  }

  return best?.result ?? null;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisição JSON inválido." },
      { status: 400 }
    );
  }

  try {
    const lat = Number(body?.origin?.lat);
    const lng = Number(body?.origin?.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return NextResponse.json(
        { error: "Coordenadas de origem inválidas." },
        { status: 400 }
      );
    }

    if (!Array.isArray(body?.redes) || body.redes.length === 0) {
      return NextResponse.json(
        { error: "Informe ao menos uma rede de supermercado." },
        { status: 400 }
      );
    }

    const origin = { lat, lng };
    const uniqueTargetMap = new Map<string, NormalizedChainRequest>();

    for (const rawRede of body.redes) {
      if (typeof rawRede !== "string") continue;
      const trimmed = rawRede.trim();
      if (!trimmed) continue;
      const built = buildChainRequest(trimmed);
      if (built.chainKey && !uniqueTargetMap.has(built.chainKey)) {
        uniqueTargetMap.set(built.chainKey, built);
      }
      if (uniqueTargetMap.size >= 15) break;
    }

    const targets = Array.from(uniqueTargetMap.values());
    if (targets.length === 0) {
      return NextResponse.json(
        { branches: [], unmatchedRedes: [] },
        { status: 200 }
      );
    }

    const resolvedByKey = new Map<string, NearbyBranchResult>();

    // 0. Cache em memória por região/rede
    for (const target of targets) {
      const cached = getCachedBranch(origin, target.chainKey);
      if (cached) resolvedByKey.set(target.chainKey, cached);
    }

    // 1. Fonte primária opcional: Google Places API (caso configurada)
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
    const pendingGoogle = targets.filter((t) => !resolvedByKey.has(t.chainKey));
    if (googleApiKey && pendingGoogle.length > 0) {
      const googleResults = await Promise.all(
        pendingGoogle.map(async (target) => {
          const candidates = await searchGooglePlaces(
            origin,
            target,
            googleApiKey
          );
          return {
            target,
            match: pickClosestMatchingCandidate(origin, target, candidates),
          };
        })
      );
      for (const { target, match } of googleResults) {
        if (match) {
          resolvedByKey.set(target.chainKey, match);
          setCachedBranch(origin, target.chainKey, match);
        }
      }
    }

    // 2. Fonte pública rápida: Photon (OpenStreetMap) com viés de proximidade em paralelo
    const pendingPhoton = targets.filter((t) => !resolvedByKey.has(t.chainKey));
    if (pendingPhoton.length > 0) {
      const photonResults = await Promise.all(
        pendingPhoton.map(async (target) => {
          const candidates = await searchPhoton(origin, target);
          return {
            target,
            match: pickClosestMatchingCandidate(origin, target, candidates),
          };
        })
      );
      for (const { target, match } of photonResults) {
        if (match) {
          resolvedByKey.set(target.chainKey, match);
          setCachedBranch(origin, target.chainKey, match);
        }
      }
    }

    // 3. OpenStreetMap Overpass API com raio progressivo (5 km -> 12 km -> 25 km)
    for (const radiusMeters of OVERPASS_RADII_METERS) {
      const pending = targets.filter((t) => !resolvedByKey.has(t.chainKey));
      if (pending.length === 0) break;

      const { candidates: overpassCandidates, reachable } =
        await searchOverpassRadius(origin, pending, radiusMeters);

      if (!reachable) break;

      for (const target of pending) {
        const match = pickClosestMatchingCandidate(
          origin,
          target,
          overpassCandidates
        );
        if (match) {
          resolvedByKey.set(target.chainKey, match);
          setCachedBranch(origin, target.chainKey, match);
        }
      }
    }

    // 4. Fallback geográfico controlado: Nominatim (com espaçamento anti rate-limit)
    const pendingForNominatim = targets.filter(
      (t) => !resolvedByKey.has(t.chainKey)
    );
    if (pendingForNominatim.length > 0) {
      for (const target of pendingForNominatim) {
        const nomCandidates = await searchNominatimFallback(origin, target);
        const match = pickClosestMatchingCandidate(
          origin,
          target,
          nomCandidates
        );
        if (match) {
          resolvedByKey.set(target.chainKey, match);
          setCachedBranch(origin, target.chainKey, match);
        }
      }
    }

    // 5. Último fallback: tabela `mercados` no Supabase
    const pendingForSupabase = targets.filter(
      (t) => !resolvedByKey.has(t.chainKey)
    );
    if (pendingForSupabase.length > 0) {
      const dbRows = await fetchSupabaseFallbackCandidates();
      const dbCandidates: CandidatePlace[] = dbRows.flatMap((row) => {
        const rowLat = Number(row.latitude);
        const rowLng = Number(row.longitude);
        if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) return [];
        return [
          {
            name: row.nome_rede,
            brand: row.nome_rede,
            unidade: row.unidade || "Unidade cadastrada",
            endereco: row.endereco || "",
            lat: rowLat,
            lng: rowLng,
            fonte: "supabase" as const,
          },
        ];
      });

      for (const target of pendingForSupabase) {
        const match = pickClosestMatchingCandidate(
          origin,
          target,
          dbCandidates
        );
        if (match) {
          resolvedByKey.set(target.chainKey, match);
        }
      }
    }

    const branches = targets
      .map((t) => resolvedByKey.get(t.chainKey))
      .filter((item): item is NearbyBranchResult => Boolean(item));
    const unmatchedRedes = targets
      .filter((t) => !resolvedByKey.has(t.chainKey))
      .map((t) => t.nome_rede);

    return NextResponse.json({ branches, unmatchedRedes }, { status: 200 });
  } catch (err) {
    console.error("Erro na rota /api/mercados/proximos:", err);
    return NextResponse.json(
      { error: "Não foi possível localizar as filiais próximas no momento." },
      { status: 500 }
    );
  }
}
