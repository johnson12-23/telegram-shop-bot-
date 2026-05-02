export type Product = {
  id: string;
  name: string;
  price: number;
  description: string;
  image: string;
  badge: string;
};

export type CartItem = Product & {
  quantity: number;
};

export type CartState = {
  items: CartItem[];
  isOpen: boolean;
};
