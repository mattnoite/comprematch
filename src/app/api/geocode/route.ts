import { NextResponse, type NextRequest } from "next/server";

interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

interface ViaCepResult {
  erro?: boolean;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const geocodeCache = new Map<string, { value: GeocodeHit; expiresAt: number }>();

function getCachedGeocode(key: string): GeocodeHit | null {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedGeocode(key: string, value: GeocodeHit): void {
  if (geocodeCache.size >= 200) {
    const oldestKey = geocodeCache.keys().next().value;
    if (oldestKey) geocodeCache.delete(oldestKey);
  }
  geocodeCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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

function isInsideBrazil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;
}

async function queryPhoton(query: string): Promise<GeocodeHit | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "3");
  // Viés suave para São Paulo para desambiguar ruas brasileiras
  url.searchParams.set("lat", "-23.5505");
  url.searchParams.set("lon", "-46.6333");

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

    if (!response.ok) return null;
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
      const countryCode = props.countrycode?.toUpperCase();
      if (countryCode && countryCode !== "BR") continue;
      if (!countryCode && !isInsideBrazil(lat, lng)) continue;

      const streetLine =
        props.street && props.housenumber
          ? `${props.street}, ${props.housenumber}`
          : props.street || props.name;
      const label = [
        streetLine,
        props.district || props.locality,
        props.city,
        props.state,
        props.postcode,
      ]
        .filter(Boolean)
        .join(", ");

      return { lat, lng, label: label || query };
    }
  } catch {
    return null;
  }

  return null;
}

async function queryNominatim(query: string): Promise<GeocodeHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("q", query);

  for (let attempt = 0; attempt < 2; attempt++) {
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

      if (!response.ok) return null;
      const data = (await response.json()) as unknown;
      if (!Array.isArray(data) || data.length === 0) return null;

      const first = data[0] as Partial<NominatimResult>;
      const lat = Number.parseFloat(first.lat ?? "");
      const lng = Number.parseFloat(first.lon ?? "");
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return {
        lat,
        lng,
        label: first.display_name ?? query,
      };
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
  }

  return null;
}

async function geocodeAddressText(query: string): Promise<GeocodeHit | null> {
  const photonHit = await queryPhoton(query);
  if (photonHit) return photonHit;
  return queryNominatim(query);
}

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!rawQuery || rawQuery.length < 3) {
    return NextResponse.json(
      { error: "Informe um CEP ou endereço válido para buscar." },
      { status: 400 }
    );
  }

  const cacheKey = rawQuery.toLowerCase();
  const cached = getCachedGeocode(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const cepDigits = rawQuery.replace(/\D/g, "");
    const isCep = /^\d{8}$/.test(cepDigits);

    if (isCep) {
      let viaCep: ViaCepResult | null = null;
      try {
        const viaCepRes = await fetchWithTimeout(
          `https://viacep.com.br/ws/${cepDigits}/json/`,
          {},
          4500
        );
        if (viaCepRes.ok) {
          viaCep = (await viaCepRes.json()) as ViaCepResult;
        }
      } catch {
        viaCep = null;
      }

      if (viaCep?.erro) {
        return NextResponse.json(
          { error: "CEP não encontrado. Verifique os dígitos informados." },
          { status: 404 }
        );
      }

      if (viaCep) {
        const formattedLabel = [
          viaCep.logradouro,
          viaCep.bairro,
          viaCep.localidade && viaCep.uf
            ? `${viaCep.localidade} - ${viaCep.uf}`
            : viaCep.localidade,
          viaCep.cep,
        ]
          .filter(Boolean)
          .join(", ");

        const candidates = [
          [viaCep.logradouro, viaCep.bairro, viaCep.localidade, viaCep.uf]
            .filter(Boolean)
            .join(", "),
          [viaCep.logradouro, viaCep.localidade, viaCep.uf, "Brasil"]
            .filter(Boolean)
            .join(", "),
          [viaCep.bairro, viaCep.localidade, viaCep.uf, "Brasil"]
            .filter(Boolean)
            .join(", "),
          [viaCep.localidade, viaCep.uf, "Brasil"].filter(Boolean).join(", "),
        ].filter(Boolean);

        for (const candidate of candidates) {
          const hit = await geocodeAddressText(candidate);
          if (hit) {
            const result: GeocodeHit = {
              lat: hit.lat,
              lng: hit.lng,
              label: formattedLabel || hit.label,
            };
            setCachedGeocode(cacheKey, result);
            return NextResponse.json(result);
          }
        }
      }
    }

    const hit = await geocodeAddressText(rawQuery);
    if (!hit) {
      return NextResponse.json(
        {
          error:
            "Endereço não localizado. Tente incluir rua, número e cidade ou use sua localização atual.",
        },
        { status: 404 }
      );
    }

    setCachedGeocode(cacheKey, hit);
    return NextResponse.json(hit);
  } catch (err) {
    console.error("Erro ao geocodificar origem:", err);
    return NextResponse.json(
      { error: "Não foi possível consultar o endereço no momento." },
      { status: 500 }
    );
  }
}
