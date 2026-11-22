export type CategoryAssetKey =
  | "cafe-chas"
  | "cervejas-vinhos"
  | "sucos-refrescos"
  | "graos-cereais"
  | "massas-molhos"
  | "snacks-doces"
  | "paes-padaria"
  | "leites-iogurtes"
  | "queijos-frios"
  | "hortifruti"
  | "acougue-carnes"
  | "cuidados-limpeza";

const ASSET_BASE = "/categories";

const CATEGORY_TO_ASSET: Record<string, CategoryAssetKey> = {
  mercearia: "graos-cereais",
  laticinios: "leites-iogurtes",
  hortifruti: "hortifruti",
  limpeza: "cuidados-limpeza",
  higiene: "cuidados-limpeza",
  matinais: "cafe-chas",
  bebidas: "sucos-refrescos",
  acougue: "acougue-carnes",
  padaria: "paes-padaria",
  outros: "snacks-doces",
};

// Refinamento por palavra-chave do nome do produto (ordem importa).
const KEYWORD_RULES: Array<[RegExp, CategoryAssetKey]> = [
  [/\b(cafe|cha|capsula|achocolatado)\b/, "cafe-chas"],
  [/\b(vinho|cerveja|espumante|chopp|whisky|vodka)\b/, "cervejas-vinhos"],
  [/\b(suco|refrigerante|refresco|agua|energetico|guarana|cola)\b/, "sucos-refrescos"],
  [/\b(arroz|feijao|aveia|cereal|granola|farinha|milho|lentilha|graos)\b/, "graos-cereais"],
  [/\b(macarrao|massa|molho|extrato|espaguete|lasanha|azeite|oleo)\b/, "massas-molhos"],
  [/\b(biscoito|bolacha|chocolate|snack|salgadinho|doce|bala|sorvete)\b/, "snacks-doces"],
  [/\b(pao|paes|bisnaguinha|torrada|croissant|bolo)\b/, "paes-padaria"],
  [/\b(leite|iogurte|manteiga|requeijao|creme de leite)\b/, "leites-iogurtes"],
  [/\b(queijo|presunto|mortadela|salame|peito de peru|frios)\b/, "queijos-frios"],
  [/\b(banana|maca|laranja|tomate|cenoura|alface|batata|cebola|fruta|legume|verdura)\b/, "hortifruti"],
  [/\b(carne|frango|bife|linguica|peixe|costela|picanha|acem|patinho)\b/, "acougue-carnes"],
  [/\b(detergente|sabao|amaciante|desinfetante|lava|limpador|shampoo|sabonete|papel higienico)\b/, "cuidados-limpeza"],
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function getProductAssetKey(
  categoria: string,
  produtoNome?: string | null
): CategoryAssetKey {
  if (produtoNome) {
    const name = normalize(produtoNome);
    for (const [pattern, key] of KEYWORD_RULES) {
      if (pattern.test(name)) return key;
    }
  }
  return CATEGORY_TO_ASSET[normalize(categoria ?? "")] ?? "graos-cereais";
}

/**
 * Retorna o caminho da silhueta em /public/categories/ para uma oferta.
 * Sempre devolve uma imagem válida (fallback: grãos e cereais).
 */
export function getProductAsset(
  categoria: string,
  produtoNome?: string | null
): string {
  return `${ASSET_BASE}/${getProductAssetKey(categoria, produtoNome)}.svg`;
}

/** Silhueta usada nas pills de categoria da vitrine. */
export function getCategoryPillAsset(categoria: string): string | null {
  const key = CATEGORY_TO_ASSET[normalize(categoria)];
  return key ? `${ASSET_BASE}/${key}.svg` : null;
}
