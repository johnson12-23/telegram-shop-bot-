import { useState } from 'react';
import { CartDrawer } from './components/CartDrawer';
import { CartIcon } from './components/CartIcon';
import { ProductGrid } from './components/ProductGrid';
import { Toast } from './components/Toast';
import { CartProvider, useCart } from './cart/useCart';
import { products } from './data/products';
import './styles/global.css';

function Shell() {
  const { openCart } = useCart();
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Classic commerce</p>
          <h1>Simple cart flow that feels fast on desktop and mobile.</h1>
          <p className="hero__copy">
            The first product opens the cart automatically. Additional items stay quiet and show a lightweight toast.
          </p>
        </div>
        <div className="hero__actions">
          <CartIcon onClick={openCart} />
          <button type="button" className="button button--ghost" onClick={openCart}>
            View Cart
          </button>
        </div>
      </header>

      <main>
        <ProductGrid products={products} onToast={setToast} />
      </main>

      <CartDrawer onContinueShopping={() => setToast('Continue shopping')} />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

export default function App() {
  return (
    <CartProvider>
      <Shell />
    </CartProvider>
  );
}
