import { useCart } from '../cart/useCart';
import type { Product } from '../cart/cartTypes';

type ProductGridProps = {
  products: Product[];
  onToast: (message: string) => void;
};

export function ProductGrid({ products, onToast }: ProductGridProps) {
  const { addToCart, openCart } = useCart();

  function handleAdd(product: Product) {
    const shouldOpenCart = addToCart(product);
    if (shouldOpenCart) {
      openCart();
      return;
    }

    onToast('Item added to cart');
  }

  return (
    <section className="product-grid" aria-label="Products">
      {products.map((product) => (
        <article className="product-card" key={product.id}>
          <div className="product-card__image-wrap">
            <img className="product-card__image" src={product.image} alt={product.name} />
            <span className="product-card__badge">{product.badge}</span>
          </div>
          <div className="product-card__body">
            <div className="product-card__meta">
              <h3>{product.name}</h3>
              <strong>${product.price}</strong>
            </div>
            <p>{product.description}</p>
            <div className="product-card__actions">
              <button type="button" className="button button--primary" onClick={() => handleAdd(product)}>
                Add to cart
              </button>
              <button type="button" className="button button--ghost" onClick={openCart}>
                View Cart
              </button>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
