import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CartItem, CartState, Product } from './cartTypes';

const STORAGE_KEY = 'classic-cart-state-v1';

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  isOpen: boolean;
  addToCart: (product: Product, quantity?: number) => boolean;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

function readInitialState(): CartState {
  if (typeof window === 'undefined') {
    return { items: [], isOpen: false };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { items: [], isOpen: false };
    }

    const parsed = JSON.parse(raw) as Partial<CartState>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      isOpen: Boolean(parsed.isOpen)
    };
  } catch {
    return { items: [], isOpen: false };
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(() => readInitialState());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = state.items.reduce((total, item) => total + item.quantity, 0);
    const subtotal = state.items.reduce((total, item) => total + item.price * item.quantity, 0);

    return {
      items: state.items,
      itemCount,
      subtotal,
      isOpen: state.isOpen,
      addToCart(product, quantity = 1) {
        let wasEmpty = state.items.length === 0;
        setState((current) => {
          const existing = current.items.find((item) => item.id === product.id);
          const nextItems = existing
            ? current.items.map((item) =>
                item.id === product.id ? { ...item, quantity: item.quantity + quantity } : item
              )
            : [...current.items, { ...product, quantity }];

          wasEmpty = current.items.length === 0;
          return { ...current, items: nextItems };
        });

        return wasEmpty;
      },
      removeFromCart(productId) {
        setState((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== productId)
        }));
      },
      updateQuantity(productId, quantity) {
        if (quantity <= 0) {
          setState((current) => ({
            ...current,
            items: current.items.filter((item) => item.id !== productId)
          }));
          return;
        }

        setState((current) => ({
          ...current,
          items: current.items.map((item) =>
            item.id === productId ? { ...item, quantity } : item
          )
        }));
      },
      clearCart() {
        setState((current) => ({ ...current, items: [] }));
      },
      openCart() {
        setState((current) => ({ ...current, isOpen: true }));
      },
      closeCart() {
        setState((current) => ({ ...current, isOpen: false }));
      }
    };
  }, [state]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }

  return context;
}
