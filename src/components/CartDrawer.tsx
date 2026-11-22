"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  MapPin,
  Minus,
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

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

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

  // Busca preco_normal apenas para itens antigos do localStorage sem esse campo
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
        className="cart-drawer-panel flex h-dvh w-full max-w-md flex-col border-l border-[#333029]/15 bg-[#F8F7F4] text-brand-dark"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-[#333029]/10 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <ShoppingBag
              className="h-5 w-5 text-brand-dark"
              aria-hidden="true"
            />
            <div>
              <h2
                id={headingId}
                className="text-sm font-extrabold tracking-tight text-brand-dark"
              >
                Sua Cesta Inteligente
              </h2>
              <p className={`${MICRO_LABEL} ${NUM}`}>
                {itemCount === 0
                  ? "Vazia"
                  : `${itemCount} ${itemCount === 1 ? "item" : "itens"} · ${groupedByMarket.length} ${groupedByMarket.length === 1 ? "parada" : "paradas"}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="cursor-pointer rounded-lg border border-[#333029]/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-taupe transition-colors hover:border-brand-gold hover:text-brand-dark"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              autoFocus
              aria-label="Fechar Sua Cesta Inteligente"
              className="inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg border border-[#333029]/10 bg-white text-brand-dark transition-colors hover:border-brand-gold"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Manifesto de carga: um bloco por mercado */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groupedByMarket.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <ReceiptText
                className="h-7 w-7 text-brand-olive"
                aria-hidden="true"
              />
              <h3 className="mt-3 text-sm font-bold text-brand-dark">
                Sua cesta está vazia
              </h3>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-brand-taupe">
                Adicione ofertas para montar a comanda de cada supermercado e
                traçar a rota.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 cursor-pointer rounded-lg bg-brand-yellow px-4 py-2 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-95"
              >
                Explorar ofertas
              </button>
            </div>
          ) : (
            groupedByMarket.map((group, idx) => (
              <section
                key={group.mercado_id}
                aria-label={`Parada ${idx + 1}: ${group.nome_rede} — ${group.unidade}`}
                className="mb-3 rounded-xl border border-[#333029]/10 bg-[#F3F1EC] p-3"
              >
                {/* Cabeçalho do bloco da loja */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <Store
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-olive"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-brand-dark">
                        {group.nome_rede}
                      </p>
                      <p className="flex items-center gap-1 truncate text-[11px] text-brand-taupe">
                        <MapPin
                          className="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        {group.unidade}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className={MICRO_LABEL}>Subtotal</p>
                    <p
                      className={`text-sm font-bold text-brand-dark ${NUM}`}
                    >
                      {formatBRL(group.subtotal)}
                    </p>
                  </div>
                </div>

                {/* Itens */}
                <ul className="mt-2.5 divide-y divide-[#333029]/10 border-t border-[#333029]/10">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs font-semibold text-brand-dark">
                          {item.produto_nome}
                        </p>
                        <p className="mt-0.5 text-[11px] text-brand-taupe">
                          {[item.marca, item.peso_volume]
                            .filter(Boolean)
                            .join(" • ")}
                          {(item.marca || item.peso_volume) && " · "}
                          <span className={NUM}>
                            {formatBRL(item.preco_oferta)}
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, -1)}
                          aria-label={`Diminuir quantidade de ${item.produto_nome}`}
                          className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-[#333029]/10 bg-white text-brand-dark transition-colors hover:border-brand-gold"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <span
                          className={`min-w-5 text-center text-xs font-bold text-brand-dark ${NUM}`}
                          aria-label={`Quantidade: ${item.quantity}`}
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, 1)}
                          aria-label={`Aumentar quantidade de ${item.produto_nome}`}
                          className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-[#333029]/10 bg-white text-brand-dark transition-colors hover:border-brand-gold"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remover ${item.produto_nome} da cesta`}
                          className="ml-0.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-brand-taupe transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* Rodapé: card de resumo escuro */}
        {items.length > 0 && (
          <div className="border-t border-[#333029]/10 p-4">
            <div className="rounded-xl bg-brand-dark p-4 text-white">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                  Total das Compras
                </span>
                <span className={`text-2xl font-black text-white ${NUM}`}>
                  {formatBRL(cartTotal)}
                </span>
              </div>

              <p
                className={`mt-1.5 text-xs font-semibold text-brand-yellow ${NUM}`}
              >
                Economia identificada de {formatBRL(totalSavings)}
              </p>

              <Link
                href="/rotas"
                onClick={onClose}
                className="mt-3 flex w-full items-center justify-center rounded-lg bg-brand-yellow py-3 text-sm font-bold text-brand-dark transition-colors hover:bg-brand-gold active:scale-95"
              >
                Traçar Rota Otimizada →
              </Link>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
