"use client";

import { Store } from "lucide-react";
import { getProductAsset } from "@/lib/categoryAssets";

export interface ProductCardItem {
  id: string;
  nome: string;
  marca?: string | null;
  peso_volume?: string | null;
  categoria: string;
  imagem_url?: string | null;
  preco_normal: number;
  preco_oferta: number;
  is_clube?: boolean;
  data_fim: string;
  mercado_nome: string;
}

interface ProductCardProps {
  produto: ProductCardItem;
  qtyInCart?: number;
  onAdd: () => void;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDateBR(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function getDiscountPercent(normal: number, oferta: number): number | null {
  if (normal <= oferta || normal <= 0) return null;
  const pct = Math.round(((normal - oferta) / normal) * 100);
  return pct >= 1 ? pct : null;
}

export function ProductCard({
  produto,
  qtyInCart = 0,
  onAdd,
}: ProductCardProps) {
  const discountPct = getDiscountPercent(
    produto.preco_normal,
    produto.preco_oferta
  );
  const hasDiscount =
    produto.preco_normal > produto.preco_oferta && produto.preco_normal > 0;

  return (
    <article className="group bg-white rounded-2xl border border-[#333029]/10 p-3.5 flex flex-col justify-between hover:border-[#CC9B29]/60 transition-all duration-200 shadow-sm">
      <div>
        {/* Área da Imagem */}
        <div className="relative w-full h-40 bg-[#F3F1EC] rounded-xl flex items-center justify-center p-3 overflow-hidden mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={produto.imagem_url || getProductAsset(produto.categoria)}
            alt={produto.nome}
            loading="lazy"
            className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
          />

          {discountPct && (
            <span className="absolute top-2 right-2 bg-[#333029] text-[#FFB400] text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
              -{discountPct}%
            </span>
          )}
        </div>

        {/* Bloco Textual */}
        <p className="text-[11px] font-semibold text-[#665A3D] uppercase tracking-wider mb-0.5 flex items-center gap-1.5">
          <Store className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{produto.mercado_nome}</span>
        </p>

        <h3 className="text-sm font-bold text-[#333029] line-clamp-2 leading-tight min-h-[2.5rem]">
          {produto.nome}
          {produto.peso_volume ? ` ${produto.peso_volume}` : ""}
        </h3>

        <span className="text-[10px] text-[#997D3D] font-medium mt-1 mb-2 block">
          Válido até {formatDateBR(produto.data_fim)}
          {produto.is_clube && (
            <span className="ml-1.5 inline-block rounded border border-[#FFB400]/40 bg-[#FFB400]/15 px-1.5 py-px font-bold text-[#333029]">
              Clube
            </span>
          )}
        </span>
      </div>

      {/* Bloco de Preço e Ação */}
      <div>
        <div className="min-h-[2.75rem] flex flex-col justify-end">
          {hasDiscount && (
            <span className="text-[11px] line-through text-[#665A3D]/70 font-mono">
              {formatBRL(produto.preco_normal)}
            </span>
          )}
          <span className="text-xl font-black font-mono tracking-tight text-[#333029]">
            {formatBRL(produto.preco_oferta)}
          </span>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="w-full mt-2 bg-[#FFB400] hover:bg-[#CC9B29] active:scale-[0.98] text-[#333029] font-bold text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          + Adicionar
          {qtyInCart > 0 && (
            <span className="ml-1 rounded-full bg-[#333029] px-1.5 py-0.5 text-[10px] font-mono font-bold text-[#FFB400]">
              {qtyInCart}
            </span>
          )}
        </button>
      </div>
    </article>
  );
}
