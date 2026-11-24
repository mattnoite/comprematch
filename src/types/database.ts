export type UserRole = "admin" | "colaborador" | "consumidor";

export interface Perfil {
  id: string;
  email: string;
  role: UserRole;
  created_at?: string | null;
}

export interface Mercado {
  id: string;
  nome_rede: string;
  unidade: string;
  endereco: string;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface Encarte {
  id: string;
  mercado_id: string;
  arquivo_url: string;
  data_inicio: string;
  data_fim: string;
  created_at: string;
}

export const OFERTA_CATEGORIAS = [
  "mercearia",
  "matinais",
  "bebidas",
  "acougue",
  "frios_laticinios",
  "hortifruti",
  "padaria",
  "limpeza",
  "descartaveis_embalagens",
  "bazar_utilidades",
  "higiene_pessoal",
  "congelados",
  "pet_shop",
  "temperos_condimentos",
] as const;

export type OfertaCategoria = (typeof OFERTA_CATEGORIAS)[number];

export interface Oferta {
  id: string;
  encarte_id: string | null;
  mercado_id: string;
  produto_nome: string;
  marca: string | null;
  peso_volume: string | null;
  categoria: string;
  preco_normal: number;
  preco_oferta: number;
  is_clube: boolean;
  data_fim: string;
  created_at: string;
}

export interface ExtractedOffer {
  produto_nome: string;
  marca: string;
  peso_volume: string;
  categoria: string;
  preco_normal: number;
  preco_oferta: number;
  is_clube: boolean;
  data_fim: string;
}

export interface ExtractQuotaStatus {
  exhausted: boolean;
  kind: "none" | "minute" | "credits";
  retryAfterSeconds: number | null;
  resetAtIso: string | null;
}

export interface ExtractApiResponse {
  mercado_sugerido_id: string | null;
  mercado_nome_detectado: string | null;
  data_inicio_sugerida: string;
  data_fim_sugerida: string;
  ofertas: ExtractedOffer[];
  model_used?: string;
  model_label?: string;
  quota?: ExtractQuotaStatus;
}
