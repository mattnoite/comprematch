import { NextResponse, type NextRequest } from "next/server";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface ViaCepResult {
  erro?: boolean;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

async function queryNominatim(query: string): Promise<NominatimResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "CompreMatch/1.0 (https://comprematch.local)",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0] as Partial<NominatimResult>;
  if (!first.lat || !first.lon) return null;

  return {
    lat: first.lat,
    lon: first.lon,
    display_name: first.display_name ?? query,
  };
}

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!rawQuery || rawQuery.length < 3) {
    return NextResponse.json(
      { error: "Informe um CEP ou endereço válido para buscar." },
      { status: 400 }
    );
  }

  try {
    const cepDigits = rawQuery.replace(/\D/g, "");
    const isCep = /^\d{8}$/.test(cepDigits);

    if (isCep) {
      const viaCepRes = await fetch(
        `https://viacep.com.br/ws/${cepDigits}/json/`,
        { cache: "no-store" }
      );

      if (viaCepRes.ok) {
        const viaCep = (await viaCepRes.json()) as ViaCepResult;
        if (viaCep.erro) {
          return NextResponse.json(
            { error: "CEP não encontrado. Verifique os dígitos informados." },
            { status: 404 }
          );
        }

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
          [viaCep.logradouro, viaCep.localidade, viaCep.uf, "Brasil"]
            .filter(Boolean)
            .join(", "),
          [viaCep.bairro, viaCep.localidade, viaCep.uf, "Brasil"]
            .filter(Boolean)
            .join(", "),
          [viaCep.localidade, viaCep.uf, "Brasil"].filter(Boolean).join(", "),
        ].filter(Boolean);

        for (const candidate of candidates) {
          const hit = await queryNominatim(candidate);
          if (hit) {
            return NextResponse.json({
              lat: Number.parseFloat(hit.lat),
              lng: Number.parseFloat(hit.lon),
              label: formattedLabel || hit.display_name,
            });
          }
        }
      }
    }

    const nominatimHit = await queryNominatim(rawQuery);
    if (!nominatimHit) {
      return NextResponse.json(
        {
          error:
            "Endereço não localizado. Tente incluir rua, número e cidade ou use sua localização atual.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      lat: Number.parseFloat(nominatimHit.lat),
      lng: Number.parseFloat(nominatimHit.lon),
      label: nominatimHit.display_name,
    });
  } catch (err) {
    console.error("Erro ao geocodificar origem:", err);
    return NextResponse.json(
      { error: "Não foi possível consultar o endereço no momento." },
      { status: 500 }
    );
  }
}
