import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, MessageCircle } from "lucide-react";
import type { Checkout } from "@shared/schema";
import { formatCurrency, formatBRL } from "@/lib/utils";

interface ExitIntentPopupProps {
  checkout: Checkout;
  originalAmount: number;
  onClose: () => void;
  onAcceptOffer?: (discountedAmount: number) => void;
  backRedirectUrl?: string | null;
}

export function ExitIntentPopup({ checkout, originalAmount, onClose, onAcceptOffer, backRedirectUrl }: ExitIntentPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasShown, setHasShown] = useState(false);

  // Preo com desconto se configurado
  const discountedAmount = checkout.exitIntent.discountPercent > 0 
    ? originalAmount * (1 - checkout.exitIntent.discountPercent / 100)
    : originalAmount;

  const formatPrice = (amount: number) => {
    if (checkout.marketTarget === 'global' && checkout.currency) {
      return formatCurrency(amount, checkout.currency);
    }
    return formatBRL(amount);
  };

  // Detectar tentativa de sair da página
  useEffect(() => {
    if (!checkout.exitIntent.enabled || hasShown) return;

    // Detectar botão voltar do navegador (popstate)
    // Se backRedirectUrl estiver configurado, cede prioridade ao back redirect handler
    const handlePopState = (event: PopStateEvent) => {
      if (backRedirectUrl) return; // back redirect tem prioridade
      event.preventDefault();
      setIsOpen(true);
      setHasShown(true);
      // Adicionar entrada no histrico para manter o usuário na página
      window.history.pushState(null, '', window.location.href);
    };

    // Detectar tentativa de fechar a página/aba
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasShown) {
        setIsOpen(true);
        setHasShown(true);
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
    };

    // Detectar movimento do mouse para fora da janela (exit intent clssico)
    const handleMouseLeave = (event: MouseEvent) => {
      // Verificar se o mouse saiu pela parte superior ou completamente da tela
      if ((event.clientY <= 0 || event.clientY <= 10) && !hasShown) {
        console.log(' EXIT INTENT DETECTADO! Mouse saiu da tela');
        setIsOpen(true);
        setHasShown(true);
      }
    };

    // Detectar movimento para reas crticas da tela 
    const handleMouseMove = (event: MouseEvent) => {
      // Detectar movimento para o topo da tela (barra de endereos)
      if (event.clientY <= 50 && event.movementY < -10 && !hasShown) {
        console.log(' EXIT INTENT DETECTADO! Movimento rpido para o topo');
        setIsOpen(true);
        setHasShown(true);
      }
    };

    // Adicionar listeners
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [checkout.exitIntent.enabled, hasShown]);


  const handleClose = () => {
    setIsOpen(false);
    onClose();
    setHasShown(true);
  };

  const handleAcceptOffer = () => {
    if (onAcceptOffer && checkout.exitIntent.discountPercent > 0) {
      onAcceptOffer(discountedAmount);
    }
    handleClose();
  };

  const handleWhatsAppClick = () => {
    const message = encodeURIComponent(checkout.exitIntent.whatsappMessage);
    const whatsappUrl = `https://wa.me/${checkout.exitIntent.whatsappNumber}?text=${message}`;
    window.open(whatsappUrl, '_blank');
    handleClose();
  };

  const handleButtonClick = () => {
    if (checkout.exitIntent.type === 'whatsapp') {
      handleWhatsAppClick();
    } else if (checkout.exitIntent.buttonUrl) {
      // Usar a URL configurada diretamente
      window.location.href = checkout.exitIntent.buttonUrl;
    } else if (checkout.exitIntent.redirectCheckoutId) {
      // Redirecionar para outro checkout usando o slug
      window.location.href = `/c/${checkout.exitIntent.redirectCheckoutId}`;
    } else if (checkout.exitIntent.discountPercent > 0) {
      handleAcceptOffer();
    } else {
      // Fallback: fechar popup
      handleClose();
    }
  };

  if (!checkout.exitIntent.enabled || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent 
        className="max-w-[95vw] sm:max-w-md md:max-w-lg w-full bg-white border border-gray-200 rounded-lg max-h-[90vh] overflow-y-auto z-[9999] p-0 shadow-xl"
        data-testid="back-redirect-popup"
      >
        {/* HEADER WHITE PROFISSIONAL */}
        <div className="relative bg-white border-b border-gray-200 p-4 sm:p-6">
          <div className="text-center space-y-2">
            <DialogTitle className="text-xl sm:text-2xl font-semibold text-gray-900 leading-tight">
              {checkout.exitIntent.title}
            </DialogTitle>
            
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              {checkout.exitIntent.description}
            </p>
          </div>
        </div>

        {/* CONTEDO PRINCIPAL WHITE */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 bg-white">
          {/* Desconto em destaque WHITE */}
          {checkout.exitIntent.discountPercent > 0 && (
            <div className="bg-gray-50 border border-gray-200 p-4 sm:p-5 rounded-lg text-center">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Desconto Especial
              </div>
              <div className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
                {checkout.exitIntent.discountPercent}% OFF
              </div>
              <div className="text-sm text-gray-600 mb-2">
                De <span className="line-through">{formatPrice(originalAmount)}</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-gray-900">
                Por {formatPrice(discountedAmount)}
              </div>
            </div>
          )}

          {/* Vdeo se configurado */}
          {checkout.exitIntent.type === 'video' && checkout.exitIntent.videoUrl && (
            <div className="aspect-video rounded-lg overflow-hidden border border-gray-200">
              <iframe
                src={checkout.exitIntent.videoUrl.replace('watch?v=', 'embed/')}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                data-testid="back-redirect-video"
              />
            </div>
          )}

          {/* BOTES WHITE PROFISSIONAIS - GRANDES E RESPONSIVOS */}
          <div className="flex flex-col gap-3 pt-2">
            {checkout.exitIntent.type === 'whatsapp' ? (
              <Button
                onClick={handleWhatsAppClick}
                className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-4 sm:py-5 text-base sm:text-lg font-semibold rounded-lg shadow-sm hover:shadow-md transition-all min-h-[56px] sm:min-h-[60px] w-full"
                data-testid="button-whatsapp"
              >
                <MessageCircle className="mr-2 h-5 w-5" />
                <span>Sim, falar no WhatsApp</span>
              </Button>
            ) : (
              <Button
                onClick={handleButtonClick}
                className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-4 sm:py-5 text-base sm:text-lg font-semibold rounded-lg shadow-sm hover:shadow-md transition-all min-h-[56px] sm:min-h-[60px] w-full"
                data-testid="button-accept-offer"
              >
                Sim, eu quero esta oferta
              </Button>
            )}

            <Button
              variant="outline"
              onClick={handleClose}
              className="border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 px-8 py-4 sm:py-5 text-base sm:text-lg font-medium rounded-lg transition-all text-gray-700 hover:text-gray-900 min-h-[56px] sm:min-h-[60px] w-full bg-white"
              data-testid="button-back"
            >
              Voltar ao checkout
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}