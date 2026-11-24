"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { normalizeChainKey, normalizeMatchText } from "@/lib/chains";

const CART_STORAGE_KEY = "comprematch_cart_v1";
const CART_EVENT_NAME = "comprematch-cart-change";
const EMPTY_CART: CartItem[] = [];

export interface CartOfferInput {
  id: string;
  produto_nome: string;
  marca: string | null;
  peso_volume: string | null;
  preco_normal?: number;
  preco_oferta: number;
  categoria: string;
  is_clube: boolean;
  data_fim?: string;
}

export interface CartMercadoInput {
  nome_rede: string;
  mercado_id?: string;
  unidade?: string;
  lat?: number;
  lng?: number;
}

export interface CartItem extends CartOfferInput, CartMercadoInput {
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  hydrated: boolean;
  addItem: (oferta: CartOfferInput, mercado: CartMercadoInput) => void;
  removeItem: (ofertaId: string) => void;
  updateQuantity: (ofertaId: string, delta: number) => void;
  pruneExpiredItems: (todayIso: string) => void;
  clearCart: () => void;
  getItemCount: () => number;
  getCartTotal: () => number;
  getTotalSavings: () => number;
}

const CartContext = createContext<CartContextValue | null>(null);

let cachedRawStorage: string | null = null;
let cachedItems: CartItem[] = EMPTY_CART;

function isValidCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const validOptionalString = (val: unknown) =>
    val === undefined || typeof val === "string";
  const validOptionalCoord = (val: unknown) =>
    val === undefined || (typeof val === "number" && Number.isFinite(val));

  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.produto_nome === "string" &&
    typeof item.preco_oferta === "number" &&
    Number.isFinite(item.preco_oferta) &&
    typeof item.categoria === "string" &&
    typeof item.is_clube === "boolean" &&
    typeof item.nome_rede === "string" &&
    item.nome_rede.trim().length > 0 &&
    validOptionalString(item.data_fim) &&
    validOptionalString(item.mercado_id) &&
    validOptionalString(item.unidade) &&
    validOptionalCoord(item.lat) &&
    validOptionalCoord(item.lng) &&
    typeof item.quantity === "number" &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0
  );
}

function getCartSnapshot(): CartItem[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw === cachedRawStorage) {
      return cachedItems;
    }
    cachedRawStorage = raw;
    if (!raw) {
      cachedItems = EMPTY_CART;
      return cachedItems;
    }
    const parsed: unknown = JSON.parse(raw);
    cachedItems = Array.isArray(parsed)
      ? parsed.filter(isValidCartItem)
      : EMPTY_CART;
    return cachedItems;
  } catch {
    // Fallback em memória caso localStorage esteja indisponível/bloqueado
    return cachedItems;
  }
}

function getServerCartSnapshot(): CartItem[] {
  return EMPTY_CART;
}

function writeStoredCart(nextItems: CartItem[]) {
  if (typeof window === "undefined") return;
  cachedItems = nextItems;
  try {
    const serialized = JSON.stringify(nextItems);
    cachedRawStorage = serialized;
    window.localStorage.setItem(CART_STORAGE_KEY, serialized);
  } catch {
    // Mantém estado apenas em memória quando localStorage está bloqueado
  }
  window.dispatchEvent(new Event(CART_EVENT_NAME));
}

function subscribeToCart(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === CART_STORAGE_KEY) {
      cachedRawStorage = null;
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CART_EVENT_NAME, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CART_EVENT_NAME, onStoreChange);
  };
}

function subscribeNoop(): () => void {
  return () => {};
}

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(
    subscribeToCart,
    getCartSnapshot,
    getServerCartSnapshot
  );
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  const addItem = useCallback(
    (oferta: CartOfferInput, mercado: CartMercadoInput) => {
      const current = getCartSnapshot();
      const targetChain = normalizeChainKey(mercado.nome_rede);
      const targetName = normalizeMatchText(oferta.produto_nome);
      const targetBrand = normalizeMatchText(oferta.marca);
      const targetWeight = normalizeMatchText(oferta.peso_volume);
      const targetPrice = Number(oferta.preco_oferta);
      const targetClube = Boolean(oferta.is_clube);

      const existingIndex = current.findIndex(
        (item) =>
          item.id === oferta.id ||
          (normalizeChainKey(item.nome_rede) === targetChain &&
            normalizeMatchText(item.produto_nome) === targetName &&
            normalizeMatchText(item.marca) === targetBrand &&
            normalizeMatchText(item.peso_volume) === targetWeight &&
            Number(item.preco_oferta) === targetPrice &&
            Boolean(item.is_clube) === targetClube)
      );

      if (existingIndex >= 0) {
        const next = current.map((item, idx) =>
          idx === existingIndex
            ? {
                ...item,
                data_fim: oferta.data_fim ?? item.data_fim,
                quantity: item.quantity + 1,
              }
            : item
        );
        writeStoredCart(next);
        return;
      }

      const precoNormalRaw =
        oferta.preco_normal !== undefined &&
        Number.isFinite(Number(oferta.preco_normal))
          ? Number(oferta.preco_normal)
          : targetPrice;

      const parsedLat =
        mercado.lat !== undefined ? Number(mercado.lat) : undefined;
      const parsedLng =
        mercado.lng !== undefined ? Number(mercado.lng) : undefined;

      const nextItem: CartItem = {
        id: oferta.id,
        produto_nome: oferta.produto_nome,
        marca: oferta.marca ?? null,
        peso_volume: oferta.peso_volume ?? null,
        preco_normal: precoNormalRaw >= targetPrice ? precoNormalRaw : targetPrice,
        preco_oferta: targetPrice,
        categoria: oferta.categoria,
        is_clube: targetClube,
        ...(oferta.data_fim ? { data_fim: oferta.data_fim } : {}),
        nome_rede: mercado.nome_rede.trim(),
        ...(mercado.mercado_id ? { mercado_id: mercado.mercado_id } : {}),
        ...(mercado.unidade !== undefined ? { unidade: mercado.unidade } : {}),
        ...(parsedLat !== undefined && Number.isFinite(parsedLat)
          ? { lat: parsedLat }
          : {}),
        ...(parsedLng !== undefined && Number.isFinite(parsedLng)
          ? { lng: parsedLng }
          : {}),
        quantity: 1,
      };

      writeStoredCart([...current, nextItem]);
    },
    []
  );

  const removeItem = useCallback((ofertaId: string) => {
    const current = getCartSnapshot();
    writeStoredCart(current.filter((item) => item.id !== ofertaId));
  }, []);

  const updateQuantity = useCallback((ofertaId: string, delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return;

    const current = getCartSnapshot();
    const next = current.flatMap((item) => {
      if (item.id !== ofertaId) return [item];
      const nextQty = item.quantity + delta;
      if (nextQty <= 0) return [];
      return [{ ...item, quantity: nextQty }];
    });
    writeStoredCart(next);
  }, []);

  const pruneExpiredItems = useCallback((todayIso: string) => {
    const current = getCartSnapshot();
    const filtered = current.filter(
      (item) => !item.data_fim || item.data_fim >= todayIso
    );
    if (filtered.length !== current.length) {
      writeStoredCart(filtered);
    }
  }, []);

  const clearCart = useCallback(() => {
    writeStoredCart(EMPTY_CART);
  }, []);

  const getItemCount = useCallback(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const getCartTotal = useCallback(
    () =>
      items.reduce(
        (sum, item) => sum + item.preco_oferta * item.quantity,
        0
      ),
    [items]
  );

  const getTotalSavings = useCallback(
    () =>
      items.reduce((sum, item) => {
        const normal = item.preco_normal ?? item.preco_oferta;
        return sum + Math.max(0, normal - item.preco_oferta) * item.quantity;
      }, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      hydrated,
      addItem,
      removeItem,
      updateQuantity,
      pruneExpiredItems,
      clearCart,
      getItemCount,
      getCartTotal,
      getTotalSavings,
    }),
    [
      items,
      hydrated,
      addItem,
      removeItem,
      updateQuantity,
      pruneExpiredItems,
      clearCart,
      getItemCount,
      getCartTotal,
      getTotalSavings,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart deve ser utilizado dentro de um CartProvider.");
  }
  return ctx;
}
