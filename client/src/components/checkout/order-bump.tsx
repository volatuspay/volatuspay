import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { Checkout } from '@shared/schema';
import { resolveImageUrl } from '@/lib/image-url';

interface OrderBumpProps {
  checkout: Checkout;
  onBumpSelected?: (selectedProducts: Array<{ checkoutId: string; price: number }>) => void;
}

export function OrderBump({ checkout, onBumpSelected }: OrderBumpProps) {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  if (!checkout.orderBump?.enabled || !checkout.orderBump?.products?.length) {
    return null;
  }

  const handleToggle = (checkoutId: string, price: number) => {
    const newSelected = new Set(selectedProducts);
    
    if (newSelected.has(checkoutId)) {
      newSelected.delete(checkoutId);
    } else {
      newSelected.add(checkoutId);
    }
    
    setSelectedProducts(newSelected);
    
    if (onBumpSelected) {
      const selectedArray = checkout.orderBump.products
        .filter(p => newSelected.has(p.checkoutId))
        .map(p => ({ checkoutId: p.checkoutId, price: p.price }));
      onBumpSelected(selectedArray);
    }
  };

  const formatPrice = (amount: number) => {
    const currency = checkout.marketTarget === 'global' 
      ? (checkout.globalSettings?.currency || 'USD')
      : 'BRL';
    const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(amount / 100);
  };

  return (
    <div className="mb-6">
      {checkout.orderBump.products.map((product, index) => {
        const isSelected = selectedProducts.has(product.checkoutId);
        
        return (
          <div 
            key={product.checkoutId}
            className={`rounded-lg border-2 p-4 transition-all cursor-pointer ${
              isSelected
                ? 'bg-gray-50 border-gray-900 shadow-sm'
                : 'bg-white border-gray-200 hover:border-gray-400'
            }`}
            onClick={() => handleToggle(product.checkoutId, product.price)}
            data-testid={`order-bump-card-${index}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Plus className={`w-4 h-4 ${isSelected ? 'text-gray-900' : 'text-gray-600'}`} />
                <span className={`font-medium text-sm ${isSelected ? 'text-green-800' : 'text-gray-800'}`}>
                  {checkout.orderBump.title || 'Adicionar ao pedido'}
                </span>
              </div>
              <Checkbox 
                checked={isSelected}
                onCheckedChange={() => handleToggle(product.checkoutId, product.price)}
                className="h-5 w-5 border-gray-300 data-[state=checked]:bg-gray-900 data-[state=checked]:border-gray-900"
                data-testid={`checkbox-order-bump-${index}`}
              />
            </div>

            {/* Subtítulo */}
            {checkout.orderBump.subtitle && (
              <p className="text-xs text-gray-500 mb-3">
                {checkout.orderBump.subtitle}
              </p>
            )}

            {/* Conteúdo do produto */}
            <div className="flex gap-3">
              {/* Imagem */}
              {product.imageUrl && (
                <div className="flex-shrink-0">
                  <img 
                    src={resolveImageUrl(product.imageUrl) || ''} 
                    alt={product.customTitle || product.title}
                    className="w-16 h-16 object-cover rounded border border-gray-100"
                    data-testid={`order-bump-image-${index}`}
                  />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-gray-900 text-sm mb-1">
                  {product.customTitle || product.title || 'Produto adicional'}
                </h4>

                {(product.customDescription || product.description) && (
                  <p className="text-xs text-gray-500 mb-2 line-clamp-2">
                    {product.customDescription || product.description}
                  </p>
                )}

                {/* Preço */}
                <div className="flex items-center gap-2 flex-wrap">
                  {product.discount > 0 && product.originalPrice && (
                    <>
                      <span className="text-xs line-through text-gray-400">
                        {formatPrice(product.originalPrice)}
                      </span>
                      <span className="bg-gray-100 text-gray-700 text-xs font-medium px-1.5 py-0.5 rounded">
                        -{product.discount}%
                      </span>
                    </>
                  )}
                  <span className="text-sm font-semibold text-gray-900">
                    + {formatPrice(product.price)}
                  </span>
                </div>
              </div>
            </div>

            {/* Selecionado */}
            {isSelected && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-gray-700 text-xs">
                <Check className="h-4 w-4" />
                <span>Adicionado ao pedido</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
