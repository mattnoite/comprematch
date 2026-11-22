export interface ChainBranchBase {
  id: string;
  nome_rede: string;
  unidade?: string;
}

export interface ChainGroup<T extends ChainBranchBase = ChainBranchBase> {
  key: string;
  nome_rede: string;
  representativeId: string;
  branches: T[];
}

function hasDiacritics(value: string): boolean {
  return /[\u0300-\u036f]/.test(value.normalize("NFD"));
}

export function normalizeChainKey(nomeRede: string): string {
  return nomeRede
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

/**
 * Agrupa filiais da mesma rede sob uma única entrada metropolitana (Grande SP),
 * escolhendo um ID representativo determinístico para vínculos de catálogo.
 */
export function groupMercadosByChain<T extends ChainBranchBase>(
  mercados: T[]
): ChainGroup<T>[] {
  const groups = new Map<string, ChainGroup<T>>();

  for (const mercado of mercados) {
    const cleanName = mercado.nome_rede.trim().replace(/\s+/g, " ");
    const key = normalizeChainKey(cleanName);
    if (!key) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.branches.push(mercado);
      if (!hasDiacritics(existing.nome_rede) && hasDiacritics(cleanName)) {
        existing.nome_rede = cleanName;
      }
    } else {
      groups.set(key, {
        key,
        nome_rede: cleanName,
        representativeId: mercado.id,
        branches: [mercado],
      });
    }
  }

  const list = Array.from(groups.values());
  for (const group of list) {
    group.branches.sort((a, b) =>
      (a.unidade ?? a.id).localeCompare(b.unidade ?? b.id, "pt-BR")
    );
    group.representativeId = group.branches[0].id;
  }

  return list.sort((a, b) => a.nome_rede.localeCompare(b.nome_rede, "pt-BR"));
}
