export type ProductDetails = {
  fabric?: string;
  color?: string;
  pattern?: string;
  fit?: string;
  style?: string;
  occasion?: string;
  careInstructions?: string;
  components?: string;
  bulletPoints?: string[];
};

export type ProductStockStatus = 'in_stock' | 'sold_out' | 'limited_stock';
