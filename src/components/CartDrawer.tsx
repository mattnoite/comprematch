"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import Link from "next/link";
import {
  MapPin,
  Minus,
  Plus,
  Route,
  ShoppingBag,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { useCart, type CartItem } from "@/hooks/useCart";

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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const groupedByMarket = useMemo<MarketGroup[]>(() => {
    const map = new Map<string, MarketGroup>();

    for (const item of items) {
      const existing = map.get(item.mercado_id);
      if (existing) {
        existing.items.push(item);
        existing.subtotal += item.preco_oferta * item.quantity;
      } else {
        map.set(item.mercado_id, {
          mercado_id: item.mercado_id,
          nome_rede: item.nome_rede,
          unidade: item.unidade,
          items: [item],
          subtotal: item.preco_oferta * item.quantity,
        });
      }
    }

    return Array.from(map.values());
  }, [items]);

  const itemCount = getItemCount();
  const cartTotal = getCartTotal();

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
        className="cart-drawer-panel flex h-dvh w-full max-w-md flex-col border-l border-brand-taupe/30 bg-[#fcfaf5] text-brand-dark shadow-2xl"
      >
        {/* Cabeçalho da gaveta */}
        <div className="flex items-center justify-between border-b border-brand-taupe/25 bg-brand-dark px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-yellow text-brand-dark">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id={headingId} className="text-base font-bold tracking-tight">
                Carrinho Inteligente
              </h2>
              <p className="text-xs text-white/75">
                {itemCount === 0
                  ? "Nenhum item selecionado"
                  : `${itemCount} ${itemCount === 1 ? "item" : "itens"} em ${groupedByMarket.length} ${groupedByMarket.length === 1 ? "mercado" : "mercados"}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="cursor-pointer rounded-lg border border-brand-taupe/60 px-2.5 py-1.5 text-xs font-semibold text-white/85 transition-colors hover:bg-brand-taupe/40 hover:text-white"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              autoFocus
              aria-label="Fechar carrinho"
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg border border-brand-taupe/60 text-white transition-colors hover:bg-brand-taupe/40"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Corpo com agrupamento por mercado */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {groupedByMarket.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-yellow/20 text-brand-olive">
                <ShoppingBag className="h-7 w-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-bold text-brand-dark">
                Seu carrinho está vazio
              </h3>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-brand-taupe">
                Adicione ofertas da vitrine para organizar suas compras por
                mercado e calcular a melhor rota.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-xs font-bold text-brand-dark transition-colors hover:bg-brand-gold"
              >
                Explorar ofertas
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByMarket.map((group) => (
                <section
                  key={group.mercado_id}
                  aria-label={`${group.nome_rede} — ${group.unidade}`}
                  className="overflow-hidden rounded-2xl border border-brand-taupe/35 bg-white shadow-2xs"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-brand-taupe/20 bg-[#faf7ef] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Store
                        className="h-4 w-4 shrink-0 text-brand-olive"
                        aria-hidden="true"
                      />
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

                    <span className="shrink-0 rounded-full bg-brand-yellow/25 px-2 py-0.5 text-[11px] font-bold text-brand-dark">
                      {group.items.reduce((acc, i) => acc + i.quantity, 0)}{" "}
                      {group.items.reduce((acc, i) => acc + i.quantity, 0) === 1
                        ? "un."
                        : "un."}
                    </span>
                  </div>

                  <ul className="divide-y divide-brand-taupe/15">
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
                              <span className="rounded bg-brand-olive px-1.5 py-0.5 text-[10px] font-bold text-white">
                                Clube
                              </span>
                            )}
                          </div>

                          {(item.marca || item.peso_volume) && (
                            <p className="mt-0.5 text-[11px] text-brand-taupe">
                              {[item.marca, item.peso_volume]
                                .filter(Boolean)
                                .join(" · ")}
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
                              className="inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-brand-taupe/40 bg-white text-brand-dark transition-colors hover:bg-brand-yellow/20"
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
                              className="inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-brand-taupe/40 bg-white text-brand-dark transition-colors hover:bg-brand-yellow/20"
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>

                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              aria-label={`Remover ${item.produto_nome} do carrinho`}
                              className="ml-1 inline-flex min-h-7 min-w-7 cursor-pointer items-center justify-center rounded-lg border border-brand-taupe/30 text-brand-taupe transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <p className="text-xs font-bold text-brand-dark">
                            {formatBRL(item.preco_oferta * item.quantity)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between border-t border-brand-taupe/20 bg-[#faf7ef] px-4 py-2.5 text-xs">
                    <span className="font-semibold text-brand-taupe">
                      Subtotal do mercado
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

        {/* Rodapé consolidado */}
        {items.length > 0 && (
          <div className="border-t border-brand-taupe/30 bg-white px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-taupe">
                Total Consolidado
              </span>
              <span className="text-xl font-extrabold text-brand-dark">
                {formatBRL(cartTotal)}
              </span>
            </div>

            <Link
              href="/rotas"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-3 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold"
            >
              <Route className="h-4 w-4" aria-hidden="true" />
              Otimizar Rota e Comprar
            </Link>
          </div>
        )}
      </div>
    </dialog>
  );
}
