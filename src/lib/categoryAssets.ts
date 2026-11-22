export const CATEGORY_MAP: Record<string, { label: string; image: string }> = {
  descartaveis_embalagens: {
    label: "Descartáveis & Embalagens",
    image: "/categories/descartaveis.webp",
  },
  bazar_utilidades: {
    label: "Bazar & Utilidades",
    image: "/categories/bazar.webp",
  },
  higiene_pessoal: {
    label: "Higiene Pessoal",
    image: "/categories/higiene.webp",
  },
  congelados: {
    label: "Congelados",
    image: "/categories/congelados.webp",
  },
  pet_shop: {
    label: "Pet Shop",
    image: "/categories/petshop.webp",
  },
  temperos_condimentos: {
    label: "Temperos & Óleos",
    image: "/categories/temperos.webp",
  },
  mercearia: {
    label: "Mercearia & Grãos",
    image: "/categories/mercearia.webp",
  },
  matinais: {
    label: "Cafés & Matinais",
    image: "/categories/cafe-matinais.webp",
  },
  bebidas: {
    label: "Bebidas",
    image: "/categories/bebidas.webp",
  },
  acougue: {
    label: "Açougue & Carnes",
    image: "/categories/carnes.webp",
  },
  frios_laticinios: {
    label: "Frios & Laticínios",
    image: "/categories/laticinios.webp",
  },
  hortifruti: {
    label: "Hortifrúti",
    image: "/categories/hortifruti.webp",
  },
  padaria: {
    label: "Padaria & Doces",
    image: "/categories/padaria.webp",
  },
  limpeza: {
    label: "Limpeza da Casa",
    image: "/categories/limpeza.webp",
  },
};

const CATEGORY_ALIASES: Record<string, string> = {
  laticinios: "frios_laticinios",
  frios: "frios_laticinios",
  "frios e laticinios": "frios_laticinios",
  higiene: "higiene_pessoal",
  "higiene pessoal": "higiene_pessoal",
  descartaveis: "descartaveis_embalagens",
  "descartaveis e embalagens": "descartaveis_embalagens",
  bazar: "bazar_utilidades",
  "bazar e utilidades": "bazar_utilidades",
  pet: "pet_shop",
  petshop: "pet_shop",
  "pet shop": "pet_shop",
  temperos: "temperos_condimentos",
  condimentos: "temperos_condimentos",
  oleos: "temperos_condimentos",
  carnes: "acougue",
  "acougue e carnes": "acougue",
  cafe: "matinais",
  "cafes e matinais": "matinais",
  outros: "mercearia",
};

export function resolveCategoryKey(categoria?: string | null): string {
  const raw = (categoria || "").toLowerCase().trim();
  if (CATEGORY_MAP[raw]) return raw;

  const ascii = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");

  if (CATEGORY_MAP[ascii]) return ascii;
  return CATEGORY_ALIASES[ascii] || "mercearia";
}

export function getProductAsset(categoria?: string | null): string {
  const key = (categoria || "").toLowerCase().trim();
  if (CATEGORY_MAP[key]) {
    return CATEGORY_MAP[key].image;
  }
  const resolved = resolveCategoryKey(categoria);
  return CATEGORY_MAP[resolved]?.image || "/categories/mercearia.webp";
}
