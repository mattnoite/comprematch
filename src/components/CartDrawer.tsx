"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MapPin,
  Minus,
  PiggyBank,
  Plus,
  ReceiptText,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { useCart, type CartItem } from "@/hooks/useCart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

interface CartDrawerProps {
  id: string;
  isOpen: boolean;
  onClose: () => void;
}

interface MarketGroup {
  mercado_id: string;
  nome_rede: string;
  unidade: string;
  items: CartItem[];
  unitCount: number;
  subtotal: number;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function CartDrawer({ id, isOpen, onClose }: CartDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const pressedOutsideRef = useRef(false);
  const headingId = useId();

  const {
    items,
    updateQuantity,
    removeItem,
    clearCart,
    getItemCount,
    getCartTotal,
  } = useCart();

  const [fallbackNormalPrices, setFallbackNormalPrices] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Busca preco_normal apenas para itens antigos no localStorage que ainda não tinham esse campo
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, items]);

  const groupedByMarket = useMemo<MarketGroup[]>(() => {
    const map = new Map<string, MarketGroup>();

    for (const item of items) {
      const existing = map.get(item.mercado_id);
      if (existing) {
        existing.items.push(item);
        existing.unitCount += item.quantity;
        existing.subtotal += item.preco_oferta * item.quantity;
      } else {
        map.set(item.mercado_id, {
          mercado_id: item.mercado_id,
          nome_rede: item.nome_rede,
          unidade: item.unidade,
          items: [item],
          unitCount: item.quantity,
          subtotal: item.preco_oferta * item.quantity,
        });
      }
    }

    return Array.from(map.values());
  }, [items]);

  const itemCount = getItemCount();
  const cartTotal = getCartTotal();

  const totalSavings = useMemo(() => {
    return items.reduce((sum, item) => {
      const normal =
        item.preco_normal ?? fallbackNormalPrices[item.id] ?? item.preco_oferta;
      return sum + Math.max(0, normal - item.preco_oferta) * item.quantity;
    }, 0);
  }, [items, fallbackNormalPrices]);

  function isOutsideSheet(target: EventTarget | null): boolean {
    if (!sheetRef.current || !(target instanceof Node)) return false;
    return !sheetRef.current.contains(target);
  }

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutsideRef.current = isOutsideSheet(event.target);
      }}
      onPointerUp={(event) => {
        if (pressedOutsideRef.current && isOutsideSheet(event.target)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
      className="cart-drawer"
    >
      <div
        ref={sheetRef}
        className="cart-drawer-panel flex h-dvh w-full max-w-md flex-col border-l border-stone-200/80 bg-[#FAFAF9] text-brand-dark shadow-2xl"
      >
        {/* Cabeçalho da Cesta */}
        <div className="flex items-center justify-between border-b border-stone-200/70 bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark shadow-xs">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id={headingId}
                className="text-base font-extrabold tracking-tight text-brand-dark"
              >
                Sua Cesta Inteligente
              </h2>
              <p className="text-xs text-brand-taupe">
                {itemCount === 0
                  ? "Nenhum item adicionado ainda"
                  : `${itemCount} ${itemCount === 1 ? "item" : "itens"} em ${groupedByMarket.length} ${groupedByMarket.length === 1 ? "comanda" : "comandas"}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="cursor-pointer rounded-xl border border-stone-200/90 bg-[#FAFAF9] px-2.5 py-1.5 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-olive hover:text-brand-dark"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              autoFocus
              aria-label="Fechar Sua Cesta Inteligente"
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-xl border border-stone-200/90 bg-white text-brand-dark transition-colors hover:border-brand-olive hover:bg-stone-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Comandas Agrupadas por Supermercado */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {groupedByMarket.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-yellow/20 text-brand-olive">
                <ReceiptText className="h-7 w-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-bold text-brand-dark">
                Sua cesta está vazia
              </h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-brand-taupe">
                Adicione produtos das ofertas ao lado para montar comandas por
                supermercado e economizar no trajeto.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-semibold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
              >
                Explorar ofertas
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByMarket.map((group, idx) => (
                <section
                  key={group.mercado_id}
                  aria-label={`Comanda ${idx + 1}: ${group.nome_rede} — ${group.unidade}`}
                  className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-2xs"
                >
                  {/* Cabeçalho da Comanda */}
                  <div className="flex items-center justify-between gap-2 border-b border-stone-100 bg-stone-50/80 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-dark text-[11px] font-bold text-brand-yellow">
                        <Store className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-brand-dark">
                          {group.nome_rede}
                        </p>
                        <p className="flex items-center gap-1 truncate text-[11px] text-brand-taupe">
                          <MapPin
                            className="h-3 w-3 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          {group.unidade}
                        </p>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full bg-brand-yellow/20 px-2.5 py-0.5 text-[11px] font-semibold text-brand-dark">
                      {group.unitCount} un.
                    </span>
                  </div>

                  {/* Itens da Comanda */}
                  <ul className="divide-y divide-stone-100">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-bold text-brand-dark">
                              {item.produto_nome}
                            </p>
                            {item.is_clube && (
                              <span className="rounded-full border border-brand-gold bg-brand-yellow/15 px-2 py-0.5 text-[10px] font-semibold text-brand-dark">
                                Preço Clube
                              </span>
                            )}
                          </div>

                          {(item.marca || item.peso_volume) && (
                            <p className="mt-0.5 text-[11px] text-brand-taupe">
                              {[item.marca, item.peso_volume]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          )}

                          <p className="mt-1 text-xs font-semibold text-brand-olive">
                            {formatBRL(item.preco_oferta)}{" "}
                            <span className="font-normal text-brand-taupe">
                              / un.
                            </span>
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, -1)}
                              aria-label={`Diminuir quantidade de ${item.produto_nome}`}
                              className="inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-[#FAFAF9] text-brand-dark transition-colors hover:border-brand-olive hover:bg-brand-yellow/15"
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>

                            <span
                              className="min-w-6 text-center text-xs font-bold text-brand-dark"
                              aria-label={`Quantidade: ${item.quantity}`}
                            >
                              {item.quantity}
                            </span>

                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, 1)}
                              aria-label={`Aumentar quantidade de ${item.produto_nome}`}
                              className="inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-[#FAFAF9] text-brand-dark transition-colors hover:border-brand-olive hover:bg-brand-yellow/15"
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>

                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              aria-label={`Remover ${item.produto_nome} da cesta`}
                              className="ml-1 inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-stone-200/80 text-brand-taupe transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <p className="text-xs font-extrabold text-brand-dark">
                            {formatBRL(item.preco_oferta * item.quantity)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Rodapé da Comanda (estilo cupom) */}
                  <div className="flex items-center justify-between border-t border-dashed border-stone-200 bg-stone-50/60 px-4 py-2.5 text-xs">
                    <span className="font-medium text-brand-taupe">
                      Subtotal da comanda
                    </span>
                    <span className="font-bold text-brand-dark">
                      {formatBRL(group.subtotal)}
                    </span>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Resumo Financeiro + Checkout Logístico */}
        {items.length > 0 && (
          <div className="space-y-3 border-t border-stone-200/80 bg-white px-5 py-4 shadow-[0_-6px_20px_rgba(51,48,41,0.05)]">
            {/* Subtotais por supermercado */}
            <div className="space-y-1 text-xs">
              {groupedByMarket.map((group) => (
                <div
                  key={group.mercado_id}
                  className="flex items-center justify-between gap-2 text-brand-taupe"
                >
                  <span className="truncate">
                    {group.nome_rede} • {group.unidade}
                  </span>
                  <span className="shrink-0 font-semibold text-brand-dark">
                    {formatBRL(group.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            {/* Badge de Economia Estimada */}
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200/90 bg-emerald-50/90 px-3.5 py-2 text-xs font-semibold text-emerald-900">
              <PiggyBank
                className="h-4 w-4 shrink-0 text-emerald-700"
                aria-hidden="true"
              />
              <span>
                Você está economizando{" "}
                <strong className="font-extrabold">
                  {formatBRL(totalSavings)}
                </strong>{" "}
                nesta compra
              </span>
            </div>

            {/* Total Geral */}
            <div className="flex items-baseline justify-between border-t border-stone-100 pt-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-taupe">
                Total da Cesta
              </span>
              <span className="text-2xl font-black tracking-tight text-brand-dark">
                {formatBRL(cartTotal)}
              </span>
            </div>

            {/* CTA de Checkout Logístico */}
            <Link
              href="/rotas"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-yellow py-3.5 text-sm font-bold text-brand-dark shadow-sm transition-all hover:bg-brand-gold active:scale-95"
            >
              <span>Traçar Rota Econômica</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </dialog>
  );
}
