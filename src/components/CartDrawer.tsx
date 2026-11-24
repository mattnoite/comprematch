"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Minus, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { useCart, type CartItem } from "@/hooks/useCart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getProductAsset } from "@/lib/categoryAssets";
import { normalizeChainKey } from "@/lib/chains";
import { getSaoPauloTodayIso } from "@/lib/date";

interface CartDrawerProps {
  id: string;
  isOpen: boolean;
  onClose: () => void;
}

interface MarketGroup {
  chainKey: string;
  nome_rede: string;
  items: CartItem[];
  unitCount: number;
  subtotal: number;
}

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
    hydrated,
    updateQuantity,
    removeItem,
    pruneExpiredItems,
    clearCart,
    getCartTotal,
  } = useCart();

  const todayIso = hydrated ? getSaoPauloTodayIso() : "";
  const expiredCount = useMemo(
    () =>
      todayIso
        ? items.filter((it) => Boolean(it.data_fim && it.data_fim < todayIso))
            .length
        : 0,
    [items, todayIso]
  );

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
      const chainKey = normalizeChainKey(item.nome_rede);
      if (!chainKey) continue;
      const existing = map.get(chainKey);
      if (existing) {
        existing.items.push(item);
        existing.unitCount += item.quantity;
        existing.subtotal += item.preco_oferta * item.quantity;
      } else {
        map.set(chainKey, {
          chainKey,
          nome_rede: item.nome_rede.trim(),
          items: [item],
          unitCount: item.quantity,
          subtotal: item.preco_oferta * item.quantity,
        });
      }
    }

    return Array.from(map.values());
  }, [items]);

  const cartTotal = getCartTotal();

  const totalSavings = useMemo(() => {
    return items.reduce((sum, item) => {
      const normal =
        item.preco_normal ?? fallbackNormalPrices[item.id] ?? item.preco_oferta;
      return sum + Math.max(0, normal - item.preco_oferta) * item.quantity;
    }, 0);
  }, [items, fallbackNormalPrices]);

  const savingsPct =
    totalSavings > 0
      ? Math.round((totalSavings / (cartTotal + totalSavings)) * 100)
      : 0;

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
        className="cart-drawer-panel flex h-dvh w-full max-w-md flex-col border-l border-[#333029]/10 bg-[#F8F7F4] text-brand-dark"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2
            id={headingId}
            className="font-serif text-2xl font-semibold tracking-tight text-brand-dark"
          >
            Sua Cesta Inteligente
          </h2>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearCart}
                className="cursor-pointer text-xs font-semibold text-brand-taupe underline underline-offset-4 transition-colors hover:text-brand-dark"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              autoFocus
              aria-label="Fechar Sua Cesta Inteligente"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#333029]/30 text-brand-dark transition-colors hover:border-brand-gold"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Paradas */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {expiredCount > 0 && (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-brand-dark"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <span>
                  {expiredCount}{" "}
                  {expiredCount === 1
                    ? "oferta na cesta expirou."
                    : "ofertas na cesta expiraram."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => pruneExpiredItems(todayIso)}
                className="shrink-0 cursor-pointer font-bold text-brand-dark underline underline-offset-2 hover:text-brand-olive"
              >
                Remover
              </button>
            </div>
          )}

          {groupedByMarket.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <ReceiptText className="h-7 w-7 text-brand-olive" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-bold text-brand-dark">
                Sua cesta está vazia
              </h3>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-brand-taupe">
                Adicione ofertas para montar a lista de cada parada e traçar a
                rota.
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
                key={group.chainKey}
                aria-label={`Parada ${idx + 1}: ${group.nome_rede}`}
                className="rounded-2xl border border-[#333029]/10 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="min-w-0 truncate text-sm font-bold text-brand-dark">
                    Parada {idx + 1}: {group.nome_rede}
                  </h3>
                  <span
                    className={`shrink-0 rounded-md bg-[#F3F1EC] px-2 py-0.5 text-xs font-bold text-brand-taupe ${NUM}`}
                    title="Unidades nesta parada"
                  >
                    {group.unitCount}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-brand-taupe">
                  Filial mais próxima selecionada ao traçar a rota
                </p>

                <ul className="mt-2 space-y-2.5">
                  {group.items.map((item) => {
                    const isExpired = Boolean(
                      item.data_fim && item.data_fim < todayIso
                    );
                    return (
                      <li key={item.id} className="flex items-center gap-2.5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F1EC] p-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getProductAsset(item.categoria)}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs leading-snug font-medium text-brand-dark">
                            {item.produto_nome}
                            {item.peso_volume ? ` ${item.peso_volume}` : ""}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <p
                              className={`text-xs font-bold text-brand-dark ${NUM}`}
                            >
                              {formatBRL(item.preco_oferta)}
                            </p>
                            {isExpired && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                Expirada
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, -1)}
                            aria-label={`Diminuir quantidade de ${item.produto_nome}`}
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-[#333029]/20 text-brand-dark transition-colors hover:border-brand-gold"
                          >
                            <Minus className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <span
                            className={`min-w-5 text-center text-xs font-bold ${NUM}`}
                            aria-label={`Quantidade: ${item.quantity}`}
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, 1)}
                            aria-label={`Aumentar quantidade de ${item.produto_nome}`}
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-brand-dark text-brand-dark transition-colors hover:border-brand-gold hover:text-brand-gold"
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
                    );
                  })}
                </ul>

                <p className="mt-3 text-right text-xs text-brand-dark">
                  Subtotal:{" "}
                  <span className={`text-sm font-bold ${NUM}`}>
                    {formatBRL(group.subtotal)}
                  </span>
                </p>
              </section>
            ))
          )}
        </div>

        {/* Rodapé fixo: card escuro */}
        {items.length > 0 && (
          <div className="p-4 pt-1">
            <div className="rounded-2xl bg-brand-dark p-4 text-white">
              <p className="text-center font-serif text-3xl font-semibold tracking-tight">
                Total:{" "}
                <span className={`text-brand-yellow ${NUM}`}>
                  {formatBRL(cartTotal)}
                </span>
              </p>

              <p
                className={`mt-2.5 rounded-full bg-brand-gold py-1.5 text-center text-xs font-bold text-brand-dark ${NUM}`}
              >
                Economia: {formatBRL(totalSavings)}
                {savingsPct > 0 && ` (${savingsPct}%)`}
              </p>

              <Link
                href="/rotas"
                onClick={onClose}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-yellow py-3 text-sm font-bold text-brand-dark transition-colors hover:bg-brand-gold active:scale-95"
              >
                Traçar Rota Otimizada ↗
              </Link>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
