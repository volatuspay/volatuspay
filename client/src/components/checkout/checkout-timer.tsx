import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import type { Checkout } from '@shared/schema';

interface CheckoutTimerProps {
  checkout: Checkout;
}

export function CheckoutTimer({ checkout }: CheckoutTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (checkout.timer?.enabled && checkout.timer?.minutes) {
      return checkout.timer.minutes * 60;
    }
    return 0;
  });

  useEffect(() => {
    if (!checkout.timer?.enabled || !checkout.timer?.minutes) return;

    const endTime = Date.now() + checkout.timer.minutes * 60 * 1000;
    
    const timer = setInterval(() => {
      const remaining = endTime - Date.now();
      
      if (remaining <= 0) {
        setTimeLeft(0);
        clearInterval(timer);
      } else {
        setTimeLeft(Math.floor(remaining / 1000));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [checkout.timer?.enabled, checkout.timer?.minutes]);

  if (!checkout.timer?.enabled || timeLeft === 0) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div 
      className="rounded-md px-3 sm:px-4 py-2 sm:py-2.5 mb-4 shadow-sm"
      style={{
        backgroundColor: checkout.timer.backgroundColor || '#dc2626',
        color: checkout.timer.color || '#ffffff'
      }}
      data-testid="checkout-timer"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Lado Esquerdo: ícone + Texto */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Clock className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-semibold truncate">
            {checkout.timer.title || 'Oferta por tempo limitado!'}
          </span>
        </div>

        {/* Lado Direito: Contador */}
        <div className="flex items-center gap-1 sm:gap-1.5 text-base sm:text-lg font-bold font-mono flex-shrink-0">
          <div className="bg-white/20 backdrop-blur-sm rounded px-1.5 sm:px-2 py-0.5 min-w-[28px] sm:min-w-[32px] text-center">
            {String(minutes).padStart(2, '0')}
          </div>
          <span className="text-sm sm:text-base">:</span>
          <div className="bg-white/20 backdrop-blur-sm rounded px-1.5 sm:px-2 py-0.5 min-w-[28px] sm:min-w-[32px] text-center">
            {String(seconds).padStart(2, '0')}
          </div>
        </div>
      </div>
    </div>
  );
}
