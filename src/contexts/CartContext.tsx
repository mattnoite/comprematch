"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

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
}

export interface CartMercadoInput {
  mercado_id: string;
  nome_rede: string;
  unidade: string;
  lat: number;
  lng: number;
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
  clearCart: () => void;
  getItemCount: () => number;
  getCartTotal: () => number;
}

const CartContext = createContext<CartContextValue | null>(null);

let cachedRawStorage: string | null = null;
let cachedItems: CartItem[] = EMPTY_CART;

function isValidCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.produto_nome === "string" &&
    typeof item.preco_oferta === "number" &&
    Number.isFinite(item.preco_oferta) &&
    typeof item.categoria === "string" &&
    typeof item.is_clube === "boolean" &&
    typeof item.mercado_id === "string" &&
    item.mercado_id.length > 0 &&
    typeof item.nome_rede === "string" &&
    typeof item.unidade === "string" &&
    typeof item.lat === "number" &&
    typeof item.lng === "number" &&
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
    return EMPTY_CART;
  }
}

function getServerCartSnapshot(): CartItem[] {
  return EMPTY_CART;
}

function writeStoredCart(nextItems: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(nextItems);
    cachedRawStorage = serialized;
    cachedItems = nextItems;
    window.localStorage.setItem(CART_STORAGE_KEY, serialized);
  } catch {
    // Fallback em memória caso localStorage esteja bloqueado
    cachedItems = nextItems;
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
      const existingIndex = current.findIndex((item) => item.id === oferta.id);

      if (existingIndex >= 0) {
        const next = current.map((item, idx) =>
          idx === existingIndex
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
        writeStoredCart(next);
        return;
      }

      const precoOferta = Number(oferta.preco_oferta);
      const precoNormalRaw =
        oferta.preco_normal !== undefined &&
        Number.isFinite(Number(oferta.preco_normal))
          ? Number(oferta.preco_normal)
          : precoOferta;

      const nextItem: CartItem = {
        id: oferta.id,
        produto_nome: oferta.produto_nome,
        marca: oferta.marca ?? null,
        peso_volume: oferta.peso_volume ?? null,
        preco_normal: precoNormalRaw >= precoOferta ? precoNormalRaw : precoOferta,
        preco_oferta: precoOferta,
        categoria: oferta.categoria,
        is_clube: Boolean(oferta.is_clube),
        mercado_id: mercado.mercado_id,
        nome_rede: mercado.nome_rede,
        unidade: mercado.unidade,
        lat: Number(mercado.lat),
        lng: Number(mercado.lng),
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

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      hydrated,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      getItemCount,
      getCartTotal,
    }),
    [
      items,
      hydrated,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      getItemCount,
      getCartTotal,
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
