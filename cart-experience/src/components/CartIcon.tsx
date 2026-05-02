import { useCart } from '../cart/useCart';

export function CartIcon({ onClick }: { onClick: () => void }) {
  const { itemCount } = useCart();

  return (
    <button className="cart-icon" type="button" onClick={onClick} aria-label={`Open cart with ${itemCount} items`}>
      <span>Cart</span>
      <span className="cart-icon__badge">{itemCount}</span>
    </button>
  );
}
