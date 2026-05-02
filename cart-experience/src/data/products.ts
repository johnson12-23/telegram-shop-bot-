import type { Product } from '../cart/cartTypes';

export const products: Product[] = [
  {
    id: 'p1',
    name: 'Heritage Leather Tote',
    price: 128,
    description: 'A timeless carryall with structured lines and a soft matte finish.',
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80',
    badge: 'Best seller'
  },
  {
    id: 'p2',
    name: 'Minimal Runner',
    price: 94,
    description: 'Lightweight comfort with a clean silhouette for everyday wear.',
    image: 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=900&q=80',
    badge: 'New'
  },
  {
    id: 'p3',
    name: 'Studio Crossbody',
    price: 76,
    description: 'Compact, polished, and ready for quick errands or city nights.',
    image: 'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80',
    badge: 'Trending'
  }
];
