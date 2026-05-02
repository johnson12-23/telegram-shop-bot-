import { useCart } from '../cart/useCart';

export function CartDrawer({ onContinueShopping }: { onContinueShopping: () => void }) {
  const { items, subtotal, isOpen, closeCart, updateQuantity, removeFromCart, clearCart } = useCart();

  function handleContinueShopping() {
    closeCart();
    onContinueShopping();
  }

  return (
    <>
      <div className={`drawer-overlay ${isOpen ? 'is-open' : ''}`} onClick={closeCart} />
      <aside className={`drawer ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen} aria-label="Cart drawer">
        <div className="drawer__header">
          <div>
            <p className="eyebrow">Your cart</p>
            <h2>Classic checkout</h2>
          </div>
          <button type="button" className="icon-button" onClick={closeCart} aria-label="Close cart">
            ×
          </button>
        </div>

        <div className="drawer__body">
          {items.length === 0 ? (
            <div className="empty-state">
              <h3>Your cart is empty</h3>
              <p>Choose a product to start the checkout flow.</p>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="cart-row">
                <img src={item.image} alt={item.name} />
                <div className="cart-row__content">
                  <div className="cart-row__top">
                    <div>
                      <h3>{item.name}</h3>
                      <p>${item.price}</p>
                    </div>
                    <button type="button" className="icon-button" onClick={() => removeFromCart(item.id)} aria-label={`Remove ${item.name}`}>
                      ×
                    </button>
                  </div>
                  <div className="cart-row__bottom">
                    <div className="quantity-control">
                      <button type="button" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                        -
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                        +
                      </button>
                    </div>
                    <strong>${item.price * item.quantity}</strong>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="drawer__footer">
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>${subtotal}</strong>
          </div>
          <div className="drawer__actions">
            <button type="button" className="button button--ghost" onClick={handleContinueShopping}>
              Continue Shopping
            </button>
            <button type="button" className="button button--primary" onClick={closeCart}>
              Close Cart
            </button>
          </div>
          <button type="button" className="button button--text" onClick={clearCart} disabled={items.length === 0}>
            Clear cart
          </button>
        </div>
      </aside>
    </>
  );
}
