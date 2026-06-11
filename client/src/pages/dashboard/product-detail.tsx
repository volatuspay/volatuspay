import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Search, Edit, Trash2, Copy, Target, ShoppingBag, Package, TrendingUp, X, CheckCircle, Upload, Save, ChevronRight } from "lucide-react";
import { SiGoogleads, SiGoogleanalytics, SiFacebook, SiTiktok, SiPinterest } from "react-icons/si";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { ImageUpload } from "@/components/ui/image-upload";
import { VideoUpload } from "@/components/ui/video-upload";
import { rtdb, auth } from "@/lib/firebase";
import { ref, push, set, onValue, remove, update } from "firebase/database";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getProduct, getProductsByTenant } from "@/lib/firestore";
import type { Product } from "@shared/schema";
import { EditCheckoutModal } from "@/components/checkout/edit-checkout-modal";
import { AffiliateManagement } from '@/components/products/affiliate-management';
import { CoproductionInvite } from '@/components/products/coproduction-invite';
import { CoproductionManagement } from '@/components/products/coproduction-management';
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuthStore } from "@/stores/auth";
import { resolveImageUrl } from "@/lib/image-url";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";

// 📊 PIXEL PLATFORM CONFIGURATION - Configuration-driven form fields
const PIXEL_PLATFORM_CONFIG = {
  google_ads: {
    label: 'Google Ads',
    icon: '📊',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      conversionId: { label: 'Conversion ID', placeholder: 'AW-XXXXXXXXXX', required: true },
      conversionLabel: { label: 'Conversion Label', placeholder: 'abc123', required: true },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'initiateCheckout', 'purchase'],
  },
  google_analytics_4: {
    label: 'Google Analytics 4',
    icon: '📈',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      measurementId: { label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX', required: true },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'beginCheckout', 'purchase'],
  },
  facebook: {
    label: 'Facebook Pixel',
    icon: '📘',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      pixelId: { label: 'Pixel ID', placeholder: '5558764788570508', required: true },
      access_token: { label: 'Access Token (Conversions API)', placeholder: 'EAAMgw...', required: false },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'initiateCheckout', 'addPaymentInfo', 'purchase'],
  },
  tiktok: {
    label: 'TikTok Pixel',
    icon: '🎵',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      pixelId: { label: 'Pixel ID', placeholder: 'C6XXXXXXXXXXXXX', required: true },
      accessToken: { label: 'Access Token (opcional)', placeholder: 'seu-access-token', required: false },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'initiateCheckout', 'purchase'],
  },
  kwai: {
    label: 'Kwai Pixel',
    icon: '🎭',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      pixelId: { label: 'Pixel ID', placeholder: '1234567890', required: true },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'initiateCheckout', 'purchase'],
  },
  pinterest: {
    label: 'Pinterest Tag',
    icon: '📌',
    fields: {
      name: { label: 'Nome', placeholder: 'Digite um nome', required: true },
      tagId: { label: 'Tag ID', placeholder: '2612345678901', required: true },
    },
    events: ['pageView', 'viewContent', 'addToCart', 'checkout', 'purchase'],
  },
} as const;

type PlatformKey = keyof typeof PIXEL_PLATFORM_CONFIG;

// 📋 SCHEMA DE VALIDAÇÃO PARA INFORMAÇÕES BÁSICAS DO PRODUTO
const productBasicInfoSchema = z.object({
  title: z.string().min(1, "Nome é obrigatório").max(60, "Máximo 60 caracteres"),
  description: z.string().max(200, "Máximo 200 caracteres").optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  currency: z.string().optional(),
  active: z.boolean().default(true),
});

type ProductBasicInfoForm = z.infer<typeof productBasicInfoSchema>;

// 🎨 PIXEL FORM DIALOG - Configuration-driven reusable component
interface PixelFormDialogProps {
  platform: PlatformKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (pixelData: any) => void;
  isPending: boolean;
  initialData?: any; // ✅ Aceita dados existentes para edição
}

function PixelFormDialog({ platform, open, onOpenChange, onSubmit, isPending, initialData }: PixelFormDialogProps) {
  const config = PIXEL_PLATFORM_CONFIG[platform];
  
  // Dynamic form state
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [events, setEvents] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState(true);

  // ✅ SAFE: Hidrata form com dados existentes OU usa valores padrão
  useEffect(() => {
    if (open) {
      if (initialData) {
        // EDITING: Carrega dados existentes sem perder nada
        const existingFormData: Record<string, any> = {};
        Object.keys(config.fields).forEach(fieldKey => {
          if (initialData[fieldKey]) {
            existingFormData[fieldKey] = initialData[fieldKey];
          }
        });
        setFormData(existingFormData);
        setEnabled(initialData.enabled ?? true);
        setEvents(initialData.events || {});
      } else {
        // CREATING: Form vazio com defaults
        setFormData({});
        setEnabled(true);
        const defaultEvents: Record<string, boolean> = {};
        config.events.forEach(event => {
          defaultEvents[event] = event === 'pageView' || event === 'viewContent';
        });
        setEvents(defaultEvents);
      }
    }
  }, [open, platform, initialData]);

  const handleSubmit = () => {
    // Validate required fields
    const requiredFieldKeys = Object.keys(config.fields).filter(
      key => config.fields[key as keyof typeof config.fields].required
    );
    const missingFields = requiredFieldKeys.filter(key => !formData[key]);
    
    if (missingFields.length > 0) {
      return; // Could show toast here
    }

    // Build payload based on platform
    const payload: any = {
      platform,
      name: formData.name,
      enabled,
      events,
    };

    // Add platform-specific fields
    Object.keys(config.fields).forEach(fieldKey => {
      if (fieldKey !== 'name' && formData[fieldKey]) {
        payload[fieldKey] = formData[fieldKey];
      }
    });

    onSubmit(payload);
    onOpenChange(false);
  };

  const getPlatformIcon = () => {
    switch (platform) {
      case 'google_ads': return <SiGoogleads className="h-5 w-5 text-[#4285F4]" />;
      case 'google_analytics_4': return <SiGoogleanalytics className="h-5 w-5 text-[#E37400]" />;
      case 'facebook': return <SiFacebook className="h-5 w-5 text-[#1877F2]" />;
      case 'tiktok': return <SiTiktok className="h-5 w-5 text-gray-900 dark:text-white" />;
      case 'kwai': return <div className="h-5 w-5 bg-orange-500 rounded text-white text-xs font-bold flex items-center justify-center">K</div>;
      case 'pinterest': return <SiPinterest className="h-5 w-5 text-[#E60023]" />;
      default: return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] bg-white dark:bg-gray-900 p-5 max-h-[85vh] overflow-y-auto">
        <DialogHeader className="pb-3">
          <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            {getPlatformIcon()}
            {config.label}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500 dark:text-gray-400">
            Configure o pixel
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {Object.entries(config.fields).map(([fieldKey, fieldConfig]) => (
            <div key={fieldKey}>
              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {fieldConfig.label}
                {fieldConfig.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <Input
                placeholder={fieldConfig.placeholder}
                value={formData[fieldKey] || ''}
                onChange={(e) => setFormData({ ...formData, [fieldKey]: e.target.value })}
                className="mt-1 h-9 text-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-lime-500/20"
              />
            </div>
          ))}

          <div className="flex items-center justify-between py-2">
            <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{enabled ? 'Ativo' : 'Inativo'}</span>
              <Switch checked={enabled} onCheckedChange={setEnabled} className="scale-90" />
            </div>
          </div>

          <div className="pt-3 border-t border-gray-200 dark:border-lime-500/20">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Eventos
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {config.events.map((eventKey) => (
                <div key={eventKey} className="flex items-center gap-2">
                  <Switch
                    checked={events[eventKey] || false}
                    onCheckedChange={(checked) =>
                      setEvents({ ...events, [eventKey]: checked })
                    }
                    className="scale-75"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400 capitalize">
                    {eventKey.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="flex-1 border-gray-300 dark:border-gray-600"
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !formData.name}
            className="flex-1 bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-50"
          >
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Componente para renderizar cada módulo com suas aulas
function ModuleCard({ module, productId, onDeleteModule, onDeleteLesson, onAddLesson, onEditLesson }: any) {
  // ✅ USAR AS AULAS QUE JÁ VÊM DO FIRESTORE via prop module.lessons
  const lessons = module.lessons || [];
  const loadingLessons = false; // Não precisa carregar, já vem do backend
  
  console.log(`📚 ModuleCard renderizado - Módulo: ${module.title}, Aulas: ${lessons.length}`);
  
  return (
    <Card className="bg-white dark:bg-transparent shadow-card mb-4">
      <CardContent className="p-0">
        {/* Cabeçalho do módulo */}
        <div className="px-3 sm:px-6 py-4 border-b border-gray-200 dark:border-lime-500/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
              </svg>
            </button>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                {module.name}
              </h3>
              {module.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {module.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Conteúdos <span className="font-semibold text-gray-900 dark:text-white ml-1">{lessons.length}</span>/15
            </div>
            <button 
              onClick={() => onDeleteModule(module.id)}
              className="p-2 text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              title="Excluir módulo"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Lista de aulas dentro do módulo */}
        <div className="px-3 sm:px-6 py-4 sm:py-8">
          {loadingLessons ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              Carregando conteúdos...
            </p>
          ) : lessons.length > 0 ? (
            lessons.map((lesson: any) => (
              <div key={lesson.id} className="mb-4 p-4 border border-gray-200 dark:border-lime-500/20 rounded-lg">
                <div className="flex items-start gap-4">
                  <button className="mt-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
                    </svg>
                  </button>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                      {lesson.title}
                    </h4>
                    {lesson.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        {lesson.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => onEditLesson(module.id, lesson)}
                      className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                      title="Editar conteúdo"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => onDeleteLesson(module.id, lesson.id)}
                      className="p-2 text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      title="Excluir conteúdo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              Nenhum conteúdo adicionado ainda
            </p>
          )}

          {/* Botão Adicionar conteúdo */}
          <Button 
            onClick={() => onAddLesson(module.id)}
            variant="outline"
            className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mt-4"
          >
            <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Adicionar conteúdo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { toast} = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("configuracoes");
  const [isEditCheckoutModalOpen, setIsEditCheckoutModalOpen] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | undefined>(undefined);

  const productId = id || "";
  const { user } = useAuthStore();
  
  const { data: productData, isLoading: isLoadingProduct } = useQuery<Product | null>({
    queryKey: ["products", productId],
    queryFn: () => getProduct(productId),
    enabled: !!productId,
  });

  // Buscar checkouts (ofertas) do produto
  const tenantId = user?.uid;
  const { data: allCheckouts = [], isLoading: isLoadingOffers } = useQuery({
    queryKey: [`/api/checkouts-by-tenant/${tenantId}`],
    enabled: !!productId && !!tenantId,
  });

  // Buscar todos os produtos do tenant para lista de estratégias
  const { data: tenantProducts = [], isLoading: isLoadingProducts } = useQuery<Product[]>({
    queryKey: ["products", tenantId],
    queryFn: () => getProductsByTenant(tenantId || ""),
    enabled: !!tenantId,
  });

  // 📊 BUSCAR TAXAS REAIS DO ADMIN (100% produção)
  const { data: paymentFees } = useQuery<{
    pixFixedFee: number;
    pixPercentFee: number;
    creditCardBRFixedFee: number;
    creditCardBRPercentFee: number;
    creditCardGlobalFixedFee: number;
    creditCardGlobalPercentFee: number;
    boletoFixedFee: number;
    boletoPercentFee: number;
  }>({
    queryKey: ['/api/payment-fees'],
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
  });


  // 🔐 PROTEÇÃO CRÍTICA: Separar ofertas vinculadas vs não-vinculadas
  
  // Ofertas VINCULADAS ao produto (syncedProductId === productId) - SEGURO para mainCheckoutId
  const linkedOffers = (allCheckouts as any[])
    .filter((checkout: any) => 
      checkout.archived !== true &&
      checkout.syncedProductId === productId
    )
    .slice(0, 10);
  
  // Apenas ofertas vinculadas a ESTE produto para seleção de afiliação
  const allOffersForAffiliate = linkedOffers;
  
  // Usar linkedOffers para mainCheckoutId (SEGURO - apenas ofertas vinculadas)
  // Usar allOffersForAffiliate para seleção de afiliação (permite não-vinculadas também)
  const offers = linkedOffers; // mainCheckoutId usará apenas ofertas vinculadas
  
  // 📝 MUTATION: Atualizar informações básicas do produto
  const updateProductMutation = useMutation({
    mutationFn: async (data: ProductBasicInfoForm) => {
      const response = await apiRequest(`/api/products/${productId}`, 'PATCH', data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products", productId] });
      queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
      toast({
        title: "Sucesso!",
        description: "Produto atualizado com sucesso",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro",
        description: error.message || "Não foi possível atualizar o produto",
      });
    },
  });

  // 📸 MUTATION: Upload de cover image
  const uploadCoverMutation = useMutation({
    mutationFn: async (file: File) => {
      const localPreview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      setCoverPreview(localPreview);

      const formData = new FormData();
      formData.append('file', file);
      
      const user = auth.currentUser;
      const token = user ? await user.getIdToken() : null;
      
      const response = await fetch(`/api/products/${productId}/cover-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro no upload');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data?.url) {
        setCoverPreview(resolveImageUrl(data.url) || data.url);
      }
      queryClient.invalidateQueries({ queryKey: ["products", productId] });
      queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
      toast({
        title: "Sucesso!",
        description: "Imagem atualizada com sucesso",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Erro no upload",
        description: error.message || "Não foi possível fazer upload da imagem",
      });
    },
  });

  // 📊 MANAGED PIXELS - AGORA NO NÍVEL DO PRODUTO (herança automática para checkouts)
  const mainCheckoutId = offers[0]?.id;

  // 🎯 BUSCAR ESTRATÉGIAS DE UPSELL/DOWNSELL DO CHECKOUT PRINCIPAL
  const { data: upsellStrategiesData, refetch: refetchStrategies } = useQuery<{ strategies: any[]; enabled: boolean }>({
    queryKey: ['/api/checkouts', mainCheckoutId, 'strategies'],
    queryFn: async () => {
      if (!mainCheckoutId) return { strategies: [], enabled: false };
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/checkouts/${mainCheckoutId}/strategies`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return { strategies: [], enabled: false };
      return res.json();
    },
    enabled: !!mainCheckoutId,
  });
  const upsellStrategies: any[] = upsellStrategiesData?.strategies || [];

  // Query: Carregar pixels do produto (não mais do checkout individual)
  const { data: pixelsData, isLoading: isLoadingPixels } = useQuery<{ pixels: any[] }>({
    queryKey: ['/api/products', productId, 'pixels'],
    enabled: !!productId,
    select: (data) => ({
      pixels: data.pixels?.map((pixel: any) => ({
        ...pixel,
        platform: normalizePlatformIdentifier(pixel.platform),
      })) || []
    }),
  });

  // ✅ NORMALIZAÇÃO DE PLATFORM IDENTIFIERS - Garante compatibilidade com dados legacy
  function normalizePlatformIdentifier(platform: string): PlatformKey {
    const kebabToSnake: Record<string, PlatformKey> = {
      'google-ads': 'google_ads',
      'google-analytics-4': 'google_analytics_4',
      'google-analytics': 'google_analytics_4',
      'facebook': 'facebook',
      'tiktok': 'tiktok',
      'kwai': 'kwai',
      'pinterest': 'pinterest',
    };
    
    const normalized = kebabToSnake[platform] || platform as PlatformKey;
    
    // Guard: Se platform inválido, retorna google_ads como fallback seguro
    if (!PIXEL_PLATFORM_CONFIG[normalized]) {
      console.warn(`⚠️ Platform inválido detectado: "${platform}" - usando fallback`);
      return 'google_ads';
    }
    
    return normalized;
  }


  // Mutation: Criar novo pixel (no produto - sincroniza para todos checkouts)
  const createPixelMutation = useMutation({
    mutationFn: async (pixelData: any) => {
      console.log('📤 Enviando pixel para produto:', pixelData);
      return apiRequest(`/api/products/${productId}/pixels`, 'POST', pixelData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products', productId, 'pixels'] });
      toast({ title: "Pixel criado e aplicado a todas as ofertas!" });
      setShowPixelFormModal(false);
    },
    onError: (error: any) => {
      toast({ title: "Erro ao criar pixel", description: error.message, variant: "destructive" });
    },
  });

  // Mutation: Deletar pixel (do produto - remove de todos checkouts)
  const deletePixelMutation = useMutation({
    mutationFn: async (pixelId: string) => {
      return apiRequest(`/api/products/${productId}/pixels/${pixelId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products', productId, 'pixels'] });
      toast({ title: "Pixel removido de todas as ofertas!" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao deletar pixel", description: error.message, variant: "destructive" });
    },
  });

  // Mutation: Atualizar pixel (no produto - sincroniza para todos checkouts)
  const updatePixelMutation = useMutation({
    mutationFn: async ({ pixelId, updates, original }: { pixelId: string; updates: any; original?: any }) => {
      const finalPayload = original ? {
        ...original,
        ...updates,
        events: {
          ...(original.events || {}),
          ...(updates.events || {}),
        },
      } : updates;
      
      console.log('📤 Enviando updates para produto:', finalPayload);
      return apiRequest(`/api/products/${productId}/pixels/${pixelId}`, 'PATCH', finalPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products', productId, 'pixels'] });
      toast({ title: "Pixel atualizado em todas as ofertas!" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao atualizar pixel", description: error.message, variant: "destructive" });
    },
  });

  // ⚠️ PIXEL TRACKING NÃO INICIALIZADO NO DASHBOARD
  // Scripts reais do Facebook/TikTok/Google NÃO devem carregar na área admin
  // Inicialização real acontece APENAS na página de checkout ([slug].tsx)
  // Aqui apenas gerenciamos (CRUD) os pixels sem disparar eventos reais

  // Mutation: Salvar estratégia (upsell/downsell/cross-sell)
  const saveStrategyMutation = useMutation({
    mutationFn: async (strategyData: any) => {
      if (!mainCheckoutId) throw new Error('Crie um checkout para este produto antes de adicionar estratégias de upsell');
      return apiRequest(`/api/checkouts/${mainCheckoutId}/upsell`, 'POST', strategyData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/checkouts', mainCheckoutId, 'strategies'] });
      refetchStrategies();
      toast({ title: "Estratégia salva com sucesso!" });
      setShowUpsellModal(false);
      // Limpar formulário
      setStrategyName("");
      setStrategyType("upsell");
      setOfferType("product");
      setSelectedProduct("");
      setCustomOfferUrl("");
      setAcceptAction("pagina-obrigado");
      setAcceptUrl("");
      setAcceptNextProduct("");
      setRefuseAction("pagina-obrigado");
      setRefuseUrl("");
      setRefuseNextProduct("");
    },
    onError: (error: any) => {
      toast({ title: "❌ Erro ao salvar estratégia", description: error.message, variant: "destructive" });
    },
  });

  // Estados para Pixels
  const [pixelSearchQuery, setPixelSearchQuery] = useState("");
  const [showPixelPlatformModal, setShowPixelPlatformModal] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>("google_ads");
  const [showPixelFormModal, setShowPixelFormModal] = useState(false);
  const [currentPlatformForm, setCurrentPlatformForm] = useState("");
  
  // Estados do formulário de pixel
  const [pixelName, setPixelName] = useState("");
  const [pixelCode, setPixelCode] = useState("");
  const [pixelLabel, setPixelLabel] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelStatus, setPixelStatus] = useState(true);
  const [pixelEvents, setPixelEvents] = useState({
    beginCheckout: false,
    addPaymentInfo: false,
    addToCart: false,
    initiateCheckout: false,
    purchase: false,
  });
  
  // Estados para Upsell/Cross Sell/Downsell
  const [upsellSearchQuery, setUpsellSearchQuery] = useState("");
  const [showUpsellModal, setShowUpsellModal] = useState(false);
  const [strategyName, setStrategyName] = useState("");
  const [strategyType, setStrategyType] = useState("upsell");
  const [offerType, setOfferType] = useState<"product" | "url">("product");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [customOfferUrl, setCustomOfferUrl] = useState("");
  const [acceptAction, setAcceptAction] = useState("pagina-obrigado");
  const [acceptUrl, setAcceptUrl] = useState("");
  const [acceptNextProduct, setAcceptNextProduct] = useState("");
  const [refuseAction, setRefuseAction] = useState("pagina-obrigado");
  const [refuseUrl, setRefuseUrl] = useState("");
  const [refuseNextProduct, setRefuseNextProduct] = useState("");
  
  // Estados para Cupons
  const [couponSearchQuery, setCouponSearchQuery] = useState("");
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [couponName, setCouponName] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponUnit, setCouponUnit] = useState("valor");
  const [couponDiscount, setCouponDiscount] = useState("");
  const [couponMinValue, setCouponMinValue] = useState("");
  const [couponExpDate, setCouponExpDate] = useState("");
  const [couponNoExpiration, setCouponNoExpiration] = useState(true);
  const [couponUsageLimit, setCouponUsageLimit] = useState("");
  const [couponNoLimit, setCouponNoLimit] = useState(true);
  const [savingCoupon, setSavingCoupon] = useState(false);

  // Função para salvar cupom
  const handleSaveCoupon = async () => {
    if (!couponCode.trim()) {
      toast({
        title: "Erro",
        description: "Digite um código para o cupom",
        variant: "destructive"
      });
      return;
    }

    if (!couponDiscount || parseFloat(couponDiscount.replace(',', '.')) <= 0) {
      toast({
        title: "Erro", 
        description: "Digite um valor de desconto válido",
        variant: "destructive"
      });
      return;
    }

    setSavingCoupon(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      
      // Parse values
      const discountValue = parseFloat(couponDiscount.replace(',', '.'));
      const minValue = couponMinValue ? parseFloat(couponMinValue.replace(',', '.')) : 0;
      const usageLimit = couponNoLimit ? 0 : (couponUsageLimit ? parseInt(couponUsageLimit) : 0);
      
      // Parse date (yyyy-mm-dd from native date input)
      let validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year default
      if (!couponNoExpiration && couponExpDate) {
        validUntil = new Date(couponExpDate + 'T23:59:59');
      }

      const couponData = {
        code: couponCode.toUpperCase(),
        name: couponName || couponCode.toUpperCase(),
        type: couponUnit === 'porcentagem' ? 'percentage' : 'fixed_amount',
        value: couponUnit === 'porcentagem' ? discountValue : Math.round(discountValue * 100),
        minAmount: Math.round(minValue * 100),
        usageLimit,
        validFrom: new Date(),
        validUntil,
        active: true,
      };

      const response = await fetch(`/api/products/${id}/coupons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(couponData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao criar cupom');
      }

      toast({
        title: "Sucesso!",
        description: "Cupom criado com sucesso",
      });

      // Reset form
      setCouponName("");
      setCouponCode("");
      setCouponDiscount("");
      setCouponMinValue("");
      setCouponExpDate("");
      setCouponUsageLimit("");
      setCouponNoExpiration(true);
      setCouponNoLimit(true);
      setCouponUnit("valor");
      setShowCouponModal(false);
      
      // Refresh coupons list
      queryClient.invalidateQueries({ queryKey: ['coupons', 'product', id] });
    } catch (error: any) {
      console.error('Erro ao criar cupom:', error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível criar o cupom",
        variant: "destructive"
      });
    } finally {
      setSavingCoupon(false);
    }
  };
  
  // Estados para Afiliação
  const [affiliateSearchQuery, setAffiliateSearchQuery] = useState("");
  const [showAffiliatePreferences, setShowAffiliatePreferences] = useState(false);
  const [affiliatesEnabled, setAffiliatesEnabled] = useState(false);
  const [showDisableAffiliateAlert, setShowDisableAffiliateAlert] = useState(false);
  const [autoApprove, setAutoApprove] = useState(true);
  const [affiliateSubTab, setAffiliateSubTab] = useState<'config' | 'manage'>('config');
  const [extendCommission, setExtendCommission] = useState(true);
  const [shareData, setShareData] = useState(true);
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(false);
  const [singleCommission, setSingleCommission] = useState("");
  const [recurringCommission, setRecurringCommission] = useState("");
  const [commissionType, setCommissionType] = useState("todas");
  const [commissionPreference, setCommissionPreference] = useState("ultimo");
  const [cookieDuration, setCookieDuration] = useState("30");
  const [selectedOffers, setSelectedOffers] = useState<string[]>([]);
  const [supportName, setSupportName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [affiliateSalesPage, setAffiliateSalesPage] = useState("");
  const [affiliateRules, setAffiliateRules] = useState("");
  
  // Estados para Coprodução
  const [coproductionSearchQuery, setCoproductionSearchQuery] = useState("");
  const [showCoproductionModal, setShowCoproductionModal] = useState(false);
  const [coproducerName, setCoproducerName] = useState("");
  const [coproductionTab, setCoproductionTab] = useState<'invite' | 'manage'>('invite');
  const [coproducerEmail, setCoproducerEmail] = useState("");
  const [coproducerCommission, setCoproducerCommission] = useState("");
  const [contractDuration, setContractDuration] = useState("vitalicio");
  const [contractMonths, setContractMonths] = useState("");
  const [commissionsOwnSales, setCommissionsOwnSales] = useState(true);
  const [commissionsAffiliateSales, setCommissionsAffiliateSales] = useState(false);
  const [shareCoproducerData, setShareCoproducerData] = useState(true);
  const [extendCoproducerCommission, setExtendCoproducerCommission] = useState(true);
  const [divideFiscalResponsibility, setDivideFiscalResponsibility] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  
  // Estados para Área de Membros
  const [membersAreaExpanded, setMembersAreaExpanded] = useState(false);
  const [classSearchQuery, setClassSearchQuery] = useState("");
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberWhatsapp, setMemberWhatsapp] = useState("");
  
  // Estados para Aulas/Módulos
  const [modulesSearchQuery, setModulesSearchQuery] = useState("");
  const [showCreateModuleModal, setShowCreateModuleModal] = useState(false);
  const [showAddLessonModal, setShowAddLessonModal] = useState(false);
  const [showEditLessonModal, setShowEditLessonModal] = useState(false);
  const [showEditModuleModal, setShowEditModuleModal] = useState(false);
  const [showSalesPageModal, setShowSalesPageModal] = useState(false);
  const [showDeleteProductModal, setShowDeleteProductModal] = useState(false);
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  const [deleteOfferTarget, setDeleteOfferTarget] = useState<string | null>(null);
  const [deleteCouponTarget, setDeleteCouponTarget] = useState<string | null>(null);
  const [currentModuleId, setCurrentModuleId] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  
  // 💾 BOTÃO FLUTUANTE - Rastreia mudanças não salvas
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  
  // Estados do formulário de módulo
  const [moduleName, setModuleName] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleReleaseType, setModuleReleaseType] = useState("liberar");
  const [moduleReleaseDays, setModuleReleaseDays] = useState("0");
  const [moduleVisibility, setModuleVisibility] = useState("mostrar");
  
  // Estados do formulário de aula/conteúdo
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonDescription, setLessonDescription] = useState("");
  const [lessonVideoType, setLessonVideoType] = useState("bunny"); // 🐰 APENAS BUNNY.NET
  const [lessonVideoUrl, setLessonVideoUrl] = useState("");
  const [lessonBunnyVideoGuid, setLessonBunnyVideoGuid] = useState(""); // 🐰 GUID DO VÍDEO NO BUNNY.NET
  const [lessonImageUrl, setLessonImageUrl] = useState(""); // 📸 CAPA VERTICAL DA AULA (NETFLIX-STYLE)
  const [lessonReleaseType, setLessonReleaseType] = useState("liberar");
  const [lessonReleaseDays, setLessonReleaseDays] = useState("0");
  const [lessonVisibility, setLessonVisibility] = useState("mostrar");
  
  // Estados para armazenar módulos e aulas do Firebase
  const [modules, setModules] = useState<any[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  
  // useEffect para carregar módulos do Firestore quando a seção "aulas" for ativada
  useEffect(() => {
    const loadModules = async () => {
      if (activeSection === "aulas" && id && auth.currentUser) {
        setLoadingModules(true);
        try {
          const token = await auth.currentUser.getIdToken();
          const response = await fetch(`/api/modules/${id}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            setModules(data.modules || []);
          } else {
            setModules([]);
          }
        } catch (error) {
          console.error('Erro ao carregar módulos:', error);
          setModules([]);
        } finally {
          setLoadingModules(false);
        }
      }
    };

    loadModules();
  }, [activeSection, id]);
  
  // Função para criar módulo REAL (FIRESTORE via API)
  const handleCreateModule = async () => {
    if (!moduleName.trim()) {
      toast({
        title: "Erro",
        description: "Digite o nome do módulo",
        variant: "destructive"
      });
      return;
    }
    
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não encontrado');

      const response = await fetch('/api/modules', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          productId: id,
          title: moduleName,
          description: moduleDescription,
          active: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao criar módulo');
      }

      const newModule = await response.json();

      toast({
        title: "Sucesso!",
        description: "Módulo criado com sucesso",
      });
      
      // ⚡ ATUALIZAÇÃO INSTANTÂNEA - Adiciona o novo módulo imediatamente
      setModules(prev => [...prev, { ...newModule, lessons: [] }]);
      
      // 🔄 INVALIDAR CACHE DA ÁREA DE MEMBROS - Para aparecer lá também
      queryClient.invalidateQueries({ queryKey: ["members-modules", id] });
      
      // Limpar formulário e fechar modal
      setModuleName("");
      setModuleDescription("");
      setModuleReleaseType("liberar");
      setModuleReleaseDays("0");
      setModuleVisibility("mostrar");
      setShowCreateModuleModal(false);
    } catch (error: any) {
      console.error("Erro ao criar módulo:", error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao criar módulo",
        variant: "destructive"
      });
    }
  };
  
  // Função para adicionar aula/conteúdo REAL (FIRESTORE via API)
  const handleAddLesson = async () => {
    if (!lessonTitle.trim()) {
      toast({
        title: "Erro",
        description: "Digite o título do conteúdo",
        variant: "destructive"
      });
      return;
    }
    
    if (!currentModuleId) {
      toast({
        title: "Erro",
        description: "Selecione um módulo",
        variant: "destructive"
      });
      return;
    }
    
    // 🚨 VALIDAÇÃO: Máximo 15 aulas por módulo
    const currentModule = modules.find(m => m.id === currentModuleId);
    if (currentModule && currentModule.lessons && currentModule.lessons.length >= 15) {
      toast({
        title: "Limite atingido",
        description: "Cada módulo pode ter no máximo 15 aulas",
        variant: "destructive"
      });
      return;
    }
    
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não encontrado');

      // 🐰 Construir URL do Bunny.net a partir do GUID
      let finalVideoUrl = lessonVideoUrl;
      if (lessonVideoType === "bunny" && lessonBunnyVideoGuid) {
        const libraryId = import.meta.env.VITE_BUNNY_STREAM_LIBRARY_ID || "";
        finalVideoUrl = `https://iframe.mediadelivery.net/embed/${libraryId}/${lessonBunnyVideoGuid}`;
      }

      const response = await fetch('/api/lessons', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          moduleId: currentModuleId,
          productId: id,
          title: lessonTitle,
          description: lessonDescription,
          videoType: lessonVideoType,
          videoUrl: finalVideoUrl,
          bunnyVideoGuid: lessonBunnyVideoGuid || undefined,
          imageUrl: lessonImageUrl,
          active: true,
          releaseAfterDays: parseInt(lessonReleaseDays) || 0,
          visibility: lessonVisibility
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao criar aula');
      }

      const newLesson = await response.json();

      toast({
        title: "Sucesso!",
        description: "Conteúdo adicionado com sucesso",
      });
      
      // ⚡ ATUALIZAÇÃO INSTANTÂNEA - Adiciona a aula imediatamente ao módulo
      setModules(prev => {
        const updated = prev.map(mod => 
          mod.id === currentModuleId
            ? { ...mod, lessons: [...(mod.lessons || []), newLesson] }
            : mod
        );
        console.log('✅ Estado modules atualizado após adicionar aula:', updated);
        return updated;
      });
      
      // 🔄 INVALIDAR CACHE DA ÁREA DE MEMBROS - Para aparecer lá também
      queryClient.invalidateQueries({ queryKey: ["members-modules", id] });
      queryClient.invalidateQueries({ queryKey: ["lessons", currentModuleId] });
      
      // Limpar formulário e fechar modal
      setLessonTitle("");
      setLessonDescription("");
      setLessonVideoType("bunny");
      setLessonVideoUrl("");
      setLessonBunnyVideoGuid("");
      setLessonImageUrl("");
      setLessonReleaseType("liberar");
      setLessonReleaseDays("0");
      setLessonVisibility("mostrar");
      setShowAddLessonModal(false);
    } catch (error: any) {
      console.error("Erro ao adicionar aula:", error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao adicionar conteúdo",
        variant: "destructive"
      });
    }
  };
  
  // 🔧 Função para abrir modal de edição de aula
  const handleOpenEditLesson = (moduleId: string, lesson: any) => {
    setCurrentModuleId(moduleId);
    setEditingLessonId(lesson.id);
    setLessonTitle(lesson.title || "");
    setLessonDescription(lesson.description || "");
    setLessonVideoType(lesson.videoType || "bunny");
    setLessonVideoUrl(lesson.videoUrl || "");
    setLessonBunnyVideoGuid(lesson.bunnyVideoGuid || "");
    setLessonImageUrl(lesson.imageUrl || "");
    setLessonReleaseDays(String(lesson.releaseAfterDays || 0));
    setLessonVisibility(lesson.visibility || "mostrar");
    setShowEditLessonModal(true);
  };
  
  // 🔧 Função para editar aula existente
  const handleEditLesson = async () => {
    if (!lessonTitle.trim()) {
      toast({
        title: "Erro",
        description: "Digite o título do conteúdo",
        variant: "destructive"
      });
      return;
    }
    
    if (!editingLessonId) {
      toast({
        title: "Erro",
        description: "ID da aula não encontrado",
        variant: "destructive"
      });
      return;
    }
    
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Token não encontrado');

      // 🐰 Construir URL do Bunny.net a partir do GUID
      let finalVideoUrl = lessonVideoUrl;
      if (lessonVideoType === "bunny" && lessonBunnyVideoGuid) {
        const libraryId = import.meta.env.VITE_BUNNY_STREAM_LIBRARY_ID || "";
        finalVideoUrl = `https://iframe.mediadelivery.net/embed/${libraryId}/${lessonBunnyVideoGuid}`;
      }

      const response = await fetch(`/api/lessons/${editingLessonId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: lessonTitle,
          description: lessonDescription,
          videoType: lessonVideoType,
          videoUrl: finalVideoUrl,
          bunnyVideoGuid: lessonBunnyVideoGuid || undefined,
          imageUrl: lessonImageUrl,
          releaseAfterDays: parseInt(lessonReleaseDays) || 0,
          visibility: lessonVisibility
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao editar aula');
      }

      const updatedLesson = await response.json();

      toast({
        title: "Sucesso!",
        description: "Conteúdo atualizado com sucesso",
      });
      
      // ⚡ ATUALIZAÇÃO INSTANTÂNEA - Atualiza a aula no módulo
      setModules(prev => {
        const updated = prev.map(mod => {
          if (mod.id === currentModuleId) {
            return {
              ...mod,
              lessons: mod.lessons.map((l: any) => 
                l.id === editingLessonId ? updatedLesson : l
              )
            };
          }
          return mod;
        });
        console.log('✅ Estado modules atualizado após editar aula:', updated);
        return updated;
      });
      
      // 🔄 INVALIDAR CACHE DA ÁREA DE MEMBROS
      queryClient.invalidateQueries({ queryKey: ["members-modules", id] });
      queryClient.invalidateQueries({ queryKey: ["lessons", currentModuleId] });
      
      // Limpar formulário e fechar modal
      setLessonTitle("");
      setLessonDescription("");
      setLessonVideoType("bunny");
      setLessonVideoUrl("");
      setLessonBunnyVideoGuid("");
      setLessonImageUrl("");
      setLessonReleaseType("liberar");
      setLessonReleaseDays("0");
      setLessonVisibility("mostrar");
      setEditingLessonId(null);
      setShowEditLessonModal(false);
    } catch (error: any) {
      console.error("Erro ao editar aula:", error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao atualizar conteúdo",
        variant: "destructive"
      });
    }
  };
  
  // Função para deletar módulo (CASCADE DELETION automático via backend)
  const handleDeleteModule = async (moduleId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Token de autenticação não encontrado');
      }

      const response = await fetch(`/api/modules/${moduleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao deletar módulo');
      }

      const result = await response.json();
      console.log('✅ Módulo deletado:', result);

      toast({
        title: "Sucesso!",
        description: "Módulo deletado com sucesso!",
      });

      // ⚡ ATUALIZAÇÃO INSTANTÂNEA - Remove o módulo da lista sem reload
      setModules(prev => prev.filter(mod => mod.id !== moduleId));
    } catch (error: any) {
      console.error("Erro ao deletar módulo:", error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao excluir módulo",
        variant: "destructive"
      });
    }
  };
  
  // Função para deletar aula (CASCADE DELETION automático via backend)
  const handleDeleteLesson = async (moduleId: string, lessonId: string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Token de autenticação não encontrado');
      }

      const response = await fetch(`/api/lessons/${lessonId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao deletar aula');
      }

      const result = await response.json();
      console.log('✅ Aula deletada:', result);

      toast({
        title: "Sucesso!",
        description: "Aula deletada com sucesso!",
      });

      // ⚡ ATUALIZAÇÃO INSTANTÂNEA - Remove a aula do módulo sem reload
      setModules(prev => prev.map(mod => 
        mod.id === moduleId
          ? { ...mod, lessons: (mod.lessons || []).filter((lesson: any) => lesson.id !== lessonId) }
          : mod
      ));
    } catch (error: any) {
      console.error("Erro ao deletar aula:", error);
      toast({
        title: "Erro",
        description: error.message || "Erro ao excluir conteúdo",
        variant: "destructive"
      });
    }
  };
  
  // Handler para salvar configurações de afiliados
  const handleSaveAffiliateSettings = async () => {
    try {
      if (!productId) {
        toast({
          title: "Erro",
          description: "ID do produto não encontrado",
          variant: "destructive"
        });
        return;
      }

      // Validação: campos de suporte são obrigatórios quando afiliação está habilitada
      if (affiliatesEnabled) {
        const missingFields = [];
        if (!supportName || supportName.trim() === '') missingFields.push('Nome do responsável');
        if (!supportEmail || supportEmail.trim() === '') missingFields.push('E-mail de suporte');
        if (!supportPhone || supportPhone.trim() === '') missingFields.push('Telefone de suporte');

        if (missingFields.length > 0) {
          toast({
            title: "Campos obrigatórios não preenchidos",
            description: `Preencha: ${missingFields.join(', ')}`,
            variant: "destructive"
          });
          return;
        }

        // Validar formato do e-mail
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(supportEmail)) {
          toast({
            title: "E-mail inválido",
            description: "Digite um e-mail válido para suporte",
            variant: "destructive"
          });
          return;
        }
      }

      // Parse seguro: valores vazios usam defaults, não NaN
      const parseSafe = (value: string, defaultValue: number): number => {
        if (!value || value.trim() === '') return defaultValue;
        const parsed = Number(value);
        return isNaN(parsed) ? defaultValue : parsed;
      };

      const affiliateConfig = {
        enabled: affiliatesEnabled,
        autoApprove,
        extendCommission,
        shareData,
        marketplaceEnabled,
        commissions: {
          single: parseSafe(singleCommission, 10),
          recurring: parseSafe(recurringCommission, 0),
          type: commissionType,
        },
        preference: commissionPreference,
        cookieDuration: parseSafe(cookieDuration, 30),
        selectedOffers: selectedOffers,
        support: {
          name: supportName,
          email: supportEmail,
          phone: supportPhone
        },
        salesPage: affiliateSalesPage,
        rules: affiliateRules
      };

      // Usar apiRequest que já gerencia autenticação automaticamente
      await apiRequest(`/api/products/${productId}/affiliate-config`, 'PATCH', affiliateConfig);

      
      // ✅ CRITICAL: Invalidar cache para recarregar dados do produto
      // Isso garante que as ofertas selecionadas sejam persistidas eternamente
      queryClient.invalidateQueries({ queryKey: ["products", productId] });
      if (tenantId) {
        queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/showcase/checkouts'] });
      
      toast({
        title: "Sucesso!",
        description: "Configurações de afiliados salvas com sucesso",
      });

      setShowAffiliatePreferences(false);
    } catch (error: any) {
      console.error("Erro ao salvar configurações de afiliados:", error);
      toast({
        title: "Erro",
        description: error?.message || error?.error || "Não foi possível salvar as configurações",
        variant: "destructive"
      });
    }
  };
  
  // Estados para Configurações (MANTIDO PARA COMPATIBILIDADE)
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [tempEmail, setTempEmail] = useState("");
  const [tempPhone, setTempPhone] = useState("");
  const [category, setCategory] = useState("apps");
  const [format, setFormat] = useState("curso");
  const [language, setLanguage] = useState("portuguese");
  const [currency, setCurrency] = useState("brl");
  const [salesPage, setSalesPage] = useState("");
  const [isActive, setIsActive] = useState(true);

  // 📸 ESTADO PARA PREVIEW DE IMAGEM
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  // 📋 REACT HOOK FORM PARA INFORMAÇÕES BÁSICAS
  const basicInfoForm = useForm<ProductBasicInfoForm>({
    resolver: zodResolver(productBasicInfoSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "apps",
      language: "pt",
      currency: "BRL",
      active: true,
    },
  });

  // useEffect para preencher form quando produto carregar
  useEffect(() => {
    if (productData) {
      // Manter compatibilidade com estados antigos
      setProductName(productData.title || "");
      setProductDescription(productData.description || "");
      setIsActive(productData.active ?? true);
      setCoverPreview(resolveImageUrl(productData.imageUrl) || null);
      
      const typeMap: Record<string, string> = {
        digital: "curso",
        subscription: "assinatura",
      };
      setFormat(typeMap[productData.productType] || "curso");
      
      // ✅ Preencher React Hook Form
      basicInfoForm.reset({
        title: productData.title || "",
        description: productData.description || "",
        category: productData.category || "apps",
        language: productData.language || "pt",
        currency: productData.currency || "BRL",
        active: productData.active ?? true,
      });
    }
  }, [productData, basicInfoForm]);

  // useEffect para carregar configurações de afiliados salvas
  useEffect(() => {
    if (productData?.affiliateConfig) {
      try {
        const config = productData.affiliateConfig as any;
        
        // Log de dados carregados para debug
        console.log('📦 Carregando affiliateConfig:', config);
        
        // Validar se valores numéricos são realmente números
        const singleCommValue = config.commissions?.single;
        const recurringCommValue = config.commissions?.recurring;
        const cookieValue = config.cookieDuration;
        
        if (singleCommValue !== undefined && typeof singleCommValue !== 'number') {
          console.warn('⚠️ singleCommission não é número:', typeof singleCommValue, singleCommValue);
        }
        if (recurringCommValue !== undefined && typeof recurringCommValue !== 'number') {
          console.warn('⚠️ recurringCommission não é número:', typeof recurringCommValue, recurringCommValue);
        }
        if (cookieValue !== undefined && typeof cookieValue !== 'number') {
          console.warn('⚠️ cookieDuration não é número:', typeof cookieValue, cookieValue);
        }
        
        setAffiliatesEnabled(config.enabled ?? false);
        setAutoApprove(config.autoApprove ?? true);
        setExtendCommission(config.extendCommission ?? true);
        setShareData(config.shareData ?? true);
        setMarketplaceEnabled(config.marketplaceEnabled ?? false);
        
        // Converter para string com segurança (número ou fallback)
        setSingleCommission(
          typeof singleCommValue === 'number' ? singleCommValue.toString() : "10"
        );
        setRecurringCommission(
          typeof recurringCommValue === 'number' ? recurringCommValue.toString() : "0"
        );
        setCommissionType(config.commissions?.type || "todas");
        
        setCommissionPreference(config.preference || "ultimo");
        setCookieDuration(
          typeof cookieValue === 'number' ? cookieValue.toString() : "30"
        );
        setSelectedOffers(Array.isArray(config.selectedOffers) ? config.selectedOffers : []);
        
        setSupportName(config.support?.name || "");
        setSupportEmail(config.support?.email || "");
        setSupportPhone(config.support?.phone || "");
        
        setAffiliateSalesPage(config.salesPage || "");
        setAffiliateRules(config.rules || "");
        
        console.log('✅ affiliateConfig carregado com sucesso');
      } catch (error) {
        console.error('❌ Erro ao carregar affiliateConfig:', error);
        // Manter valores padrão em caso de erro
      }
    }
  }, [productData]);


  // Dados do produto (virá do backend via Firestore)
  const product = {
    name: productName,
    type: format,
    revenue: "R$ 0,00",
    sales: 0,
  };

  // Verificar se o produto suporta área de membros (Digital e Subscription)
  const hasMembersArea = productData?.productType === "digital" || productData?.productType === "subscription";
  const [membersAreaEnabled, setMembersAreaEnabled] = useState(false);
  const [allowMultiplePurchases, setAllowMultiplePurchases] = useState(false);
  
  useEffect(() => {
    if (productData?.membersAreaEnabled !== undefined) {
      setMembersAreaEnabled(!!productData.membersAreaEnabled);
    }
  }, [productData?.membersAreaEnabled]);

  useEffect(() => {
    setAllowMultiplePurchases(!!(productData as any)?.allowMultiplePurchases);
  }, [(productData as any)?.allowMultiplePurchases]);

  
  // Menu lateral - Tipo do item de menu
  type MenuItem = {
    id: string;
    label: string;
    hasSubmenu?: boolean;
    submenu?: { id: string; label: string }[];
  };
  
  // 🔍 DETECTAR MUDANÇAS AUTOMATICAMENTE (BOTÃO FLUTUANTE)
  useEffect(() => {
    const originalConfig = (product as any)?.affiliateConfig || {};
    
    const hasChanges = 
      basicInfoForm?.formState?.isDirty || 
      (affiliatesEnabled !== (originalConfig.enabled ?? false)) ||
      (marketplaceEnabled !== (originalConfig.marketplaceEnabled ?? false)) ||
      (autoApprove !== (originalConfig.autoApprove ?? true)) ||
      (extendCommission !== (originalConfig.extendCommission ?? true)) ||
      (shareData !== (originalConfig.shareData ?? true)) ||
      (singleCommission !== String(originalConfig.commissions?.single ?? 10)) ||
      (recurringCommission !== String(originalConfig.commissions?.recurring ?? 0)) ||
      (commissionType !== (originalConfig.commissions?.type ?? "todas")) ||
      (supportName !== (originalConfig.support?.name ?? "")) ||
      (supportEmail !== (originalConfig.support?.email ?? "")) ||
      (supportPhone !== (originalConfig.support?.phone ?? ""));
    
    setHasUnsavedChanges(hasChanges);
  }, [
    basicInfoForm?.formState?.isDirty,
    affiliatesEnabled,
    marketplaceEnabled,
    autoApprove,
    extendCommission,
    shareData,
    singleCommission,
    recurringCommission,
    commissionType,
    supportName,
    supportEmail,
    supportPhone,
    product,
  ]);
  
  // 💾 FUNÇÃO UNIFICADA - Salvar todas as configurações de uma vez
  const handleSaveAllChanges = async () => {
    setIsSavingAll(true);
    try {
      // 1️⃣ Salvar informações básicas
      if (basicInfoForm.formState.isDirty) {
        const basicData = basicInfoForm.getValues();
        await apiRequest(`/api/products/${productId}`, 'PATCH', basicData);
      }

      // 2️⃣ Salvar configurações de afiliados (SEMPRE salvar quando houver mudanças não salvas)
      // Isso garante que TODOS os campos sejam salvos, não só os toggles
      if (hasUnsavedChanges) {
        const parseSafe = (value: string, defaultValue: number): number => {
          if (!value || value.trim() === '') return defaultValue;
          const parsed = Number(value);
          return isNaN(parsed) ? defaultValue : parsed;
        };

        const affiliateConfig = {
          enabled: affiliatesEnabled,
          autoApprove,
          extendCommission,
          shareData,
          marketplaceEnabled,
          commissions: {
            single: parseSafe(singleCommission, 10),
            recurring: parseSafe(recurringCommission, 0),
            type: commissionType,
          },
          preference: commissionPreference,
          cookieDuration: parseSafe(cookieDuration, 30),
          selectedOffers: selectedOffers,
          support: {
            name: supportName,
            email: supportEmail,
            phone: supportPhone
          },
          salesPage: affiliateSalesPage,
          rules: affiliateRules
        };
        await apiRequest(`/api/products/${productId}/affiliate-config`, 'PATCH', affiliateConfig);
      }

      toast({
        title: "✅ Tudo Salvo!",
        description: "Todas as configurações foram salvas com sucesso",
      });

      setHasUnsavedChanges(false);
      await queryClient.invalidateQueries({ queryKey: [`/api/products/${productId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/showcase/checkouts'] });
    } catch (error: any) {
      toast({
        title: "Erro ao Salvar",
        description: error?.message || error?.error || "Ocorreu um erro ao salvar as configurações",
        variant: "destructive"
      });
    } finally {
      setIsSavingAll(false);
    }
  };
  
  // Construir menu IMUTAVELMENTE baseado no tipo de produto
  const baseMenuItems: MenuItem[] = [
    { id: "configuracoes", label: "Configurações" },
    { id: "checkouts", label: "Checkouts" },
  ];
  
  const membersAreaMenuItem: MenuItem = { 
    id: "area-membros", 
    label: "Área de Membros",
    hasSubmenu: true,
    submenu: [
      { id: "aulas", label: "Aulas" },
      { id: "alunos", label: "Alunos" },
    ]
  };
  
  const otherMenuItems: MenuItem[] = [
    { id: "upsell", label: "Upsell, downsell e mais" },
    { id: "cupons", label: "Cupons" },
    { id: "afiliacao", label: "Afiliação" },
    { id: "coproducao", label: "Coprodução" },
    { id: "pixels", label: "Pixels" },
    { id: "apagar-produto", label: "Apagar Produto" },
  ];
  
  // Montar array final: adiciona "Área de Membros" APENAS se digital ou subscription
  const menuItems: MenuItem[] = hasMembersArea 
    ? [...baseMenuItems, membersAreaMenuItem, ...otherMenuItems]
    : [...baseMenuItems, ...otherMenuItems];

  // Cupons - Buscar cupons do produto do Firebase
  const { data: couponsData = [], isLoading: isLoadingCoupons, refetch: refetchCoupons } = useQuery<any[]>({
    queryKey: ['coupons', 'product', id],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${id}/coupons`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Erro ao buscar cupons');
      const result = await response.json();
      return result.coupons || [];
    },
    enabled: !!id && !!auth.currentUser,
  });
  
  const coupons = couponsData;

  if (isLoadingProduct) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Carregando produto...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!productData) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Produto não encontrado</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">Este produto não existe ou foi removido.</p>
            <Button onClick={() => navigate("/dashboard/products-list")} className="bg-blue-600 hover:bg-blue-700">
              Voltar para lista de produtos
            </Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="overflow-y-auto">
        <div className="px-3 py-4 md:p-6 space-y-4 md:space-y-6">
          {/* Navegação Horizontal no Topo */}
          <div className="bg-white dark:bg-transparent rounded-lg border border-gray-200 dark:border-lime-500/20 overflow-x-auto">
            <div className="p-2">
              <div className="flex items-center gap-1 min-w-max">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.hasSubmenu) {
                        setMembersAreaExpanded(!membersAreaExpanded);
                      } else {
                        setActiveSection(item.id);
                      }
                    }}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center gap-1.5 whitespace-nowrap ${
                      activeSection === item.id || (item.submenu?.some(sub => sub.id === activeSection))
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600"
                        : "bg-transparent text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 hover:shadow-md hover:border hover:border-gray-200 dark:hover:border-gray-700"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.hasSubmenu && (
                      <svg
                        className={`h-3.5 w-3.5 transition-transform ${membersAreaExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              
              {/* Submenu dentro do mesmo card, logo abaixo */}
              {membersAreaExpanded && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 mr-3 border-r border-gray-200 dark:border-gray-700 pr-3">
                    <Switch 
                      checked={membersAreaEnabled} 
                      onCheckedChange={async (checked) => {
                        try {
                          const token = await auth.currentUser?.getIdToken();
                          await fetch(`/api/products/${id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ membersAreaEnabled: checked }),
                          });
                          setMembersAreaEnabled(checked);
                          await queryClient.invalidateQueries({ queryKey: [`/api/products/${id}`] });
                          toast({ title: checked ? "Area de membros ativada" : "Area de membros desativada" });
                        } catch (err) {
                          toast({ title: "Erro ao salvar", variant: "destructive" });
                        }
                      }}
                      className="scale-90"
                      data-testid="toggle-members-area"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {membersAreaEnabled ? "Ativa" : "Inativa"}
                    </span>
                  </div>
                  {menuItems.find(item => item.hasSubmenu)?.submenu?.map((subitem) => (
                    <button
                      key={subitem.id}
                      onClick={() => {
                        if (membersAreaEnabled) {
                          setActiveSection(subitem.id);
                        } else {
                          toast({ title: "Ative a area de membros primeiro", variant: "destructive" });
                        }
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 flex items-center gap-1 whitespace-nowrap ${
                        !membersAreaEnabled
                          ? "opacity-50 cursor-not-allowed bg-gray-50 dark:bg-transparent text-gray-400 border border-gray-200 dark:border-gray-700"
                          : activeSection === subitem.id
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700"
                            : "bg-gray-50 dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-lime-500/20"
                      }`}
                    >
                      <span>{subitem.label}</span>
                      {activeSection === subitem.id && membersAreaEnabled && (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {/* Seção de Checkouts */}
            {activeSection === "checkouts" && (
              <>
                {/* Barra de Busca e Botão */}
                <div className="flex gap-3 items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="Buscar"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                    />
                  </div>
                  <Button 
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => {
                      setSelectedOfferId(undefined);
                      setIsEditCheckoutModalOpen(true);
                    }}
                  >
                    Criar oferta
                  </Button>
                </div>

                {/* Tabela de Ofertas */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-lime-500/20">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Nome
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Valor
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Tipo
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                              Acesso
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-transparent divide-y divide-gray-200 dark:divide-gray-700">
                          {isLoadingOffers ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center">
                                <div className="text-gray-500 dark:text-gray-400">Carregando ofertas...</div>
                              </td>
                            </tr>
                          ) : offers.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center">
                                <div className="text-gray-500 dark:text-gray-400">Nenhuma oferta criada ainda</div>
                              </td>
                            </tr>
                          ) : (
                            offers.map((offer: any) => {
                              const checkoutUrl = `https://${window.location.host}/c/${offer.id}`;
                              const priceInReais = (offer.pricing?.amount || 0) / 100;
                              const productType = productData?.productType || "digital";
                              
                              // Verificar se é assinatura PRIMEIRO
                              const isSubscription = productType === "subscription";
                              
                              // Mapear período da assinatura (APENAS se for assinatura)
                              const subscriptionPeriod = isSubscription ? (offer.pricing?.subscriptionPeriod || "monthly") : null;
                              const periodLabels = {
                                monthly: { short: "/mês", full: "Mensal" },
                                quarterly: { short: "/trimestre", full: "Trimestral" },
                                semiannual: { short: "/semestre", full: "Semestral" },
                                annual: { short: "/ano", full: "Anual" }
                              };
                              const periodLabel = subscriptionPeriod ? periodLabels[subscriptionPeriod as keyof typeof periodLabels] : null;
                              
                              return (
                                <tr key={offer.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                                      {offer.title || 'Sem nome'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm">
                                      <span className="font-medium text-gray-900 dark:text-white">
                                        R$ {priceInReais.toFixed(2).replace('.', ',')}
                                      </span>
                                      {isSubscription && periodLabel && (
                                        <span className="text-gray-500 dark:text-gray-400">
                                          {periodLabel.short}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm">
                                      <div className="font-medium text-gray-900 dark:text-white">
                                        {isSubscription ? "Assinatura" : "Pagamento Único"}
                                      </div>
                                      {isSubscription && periodLabel && (
                                        <div className="text-gray-500 dark:text-gray-400">
                                          {periodLabel.full}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                      <Switch checked={offer.active !== false} />
                                      <span className="text-sm text-gray-600 dark:text-gray-400">
                                        {offer.active !== false ? "Ativo" : "Inativo"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                      <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400">
                                        <span className="truncate max-w-[60px]">https://</span>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                                          onClick={() => {
                                            navigator.clipboard.writeText(checkoutUrl);
                                            toast({
                                              title: "Link copiado!",
                                              description: "O link do checkout foi copiado para a área de transferência.",
                                            });
                                          }}
                                        >
                                          <Copy className="h-3 w-3" />
                                        </Button>
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          console.log('🔥 CLICOU EDITAR - Offer ID:', offer.id);
                                          setSelectedOfferId(offer.id);
                                          setIsEditCheckoutModalOpen(true);
                                          console.log('🔥 ESTADOS ATUALIZADOS - Modal deve abrir agora');
                                        }}
                                        title="Editar oferta"
                                      >
                                        <Edit className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setDeleteOfferTarget(offer.id)}
                                        className="h-8 w-8 p-0 hover:bg-red-50 dark:hover:bg-red-900/20"
                                      >
                                    <Trash2 className="h-4 w-4 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Seção de Configurações */}
            {activeSection === "configuracoes" && (
              <div className="space-y-6">
                {/* Informações Básicas */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          Informações básicas
                        </h3>
                        <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                          <span className="text-xs text-gray-500 dark:text-gray-400">ID:</span>
                          <code className="text-xs font-mono text-[#2563eb] dark:text-blue-400 select-all">{productId}</code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                            onClick={() => {
                              navigator.clipboard.writeText(productId || '');
                              toast({ title: "ID copiado!", description: "ID do produto copiado para área de transferência." });
                            }}
                          >
                            <Copy className="h-3 w-3 text-gray-500" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
                        <Switch 
                          checked={basicInfoForm.watch("active")} 
                          onCheckedChange={(checked) => basicInfoForm.setValue("active", checked)}
                        />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {basicInfoForm.watch("active") ? "Ativo" : "Inativo"}
                        </span>

                        <span className="text-gray-300 dark:text-gray-600 mx-1">|</span>

                        <span className="text-sm text-gray-600 dark:text-gray-400">Compras ilimitadas:</span>
                        <Switch
                          checked={allowMultiplePurchases}
                          onCheckedChange={async (checked) => {
                            try {
                              const token = await auth.currentUser?.getIdToken();
                              await fetch(`/api/products/${id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                body: JSON.stringify({ allowMultiplePurchases: checked }),
                              });
                              setAllowMultiplePurchases(checked);
                              await queryClient.invalidateQueries({ queryKey: [`/api/products/${id}`] });
                              toast({ title: checked ? "Compras ilimitadas ativadas" : "Compras ilimitadas desativadas", description: checked ? "O mesmo cliente pode comprar este produto várias vezes." : "Cada cliente pode comprar apenas 1x." });
                            } catch (err) {
                              toast({ title: "Erro ao salvar", variant: "destructive" });
                            }
                          }}
                        />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {allowMultiplePurchases ? "Ativado" : "Desativado"}
                        </span>

                        {/* Botão Salvar ao lado do Status */}
                        <Button
                          onClick={handleSaveAllChanges}
                          disabled={isSavingAll}
                          size="sm"
                          className="ml-4 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium px-4 py-2 rounded-lg transition-all duration-200 flex items-center gap-2"
                        >
                          {isSavingAll ? (
                            <>
                              <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                              Salvando...
                            </>
                          ) : (
                            <>
                              <Save className="w-3 h-3" />
                              Salvar
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <Form {...basicInfoForm}>
                      <form onSubmit={basicInfoForm.handleSubmit((data) => {
                        updateProductMutation.mutate(data);
                      })} className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          {/* Product Cover - UPLOAD REAL */}
                          <div className="lg:col-span-1">
                            <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                              Capa do produto
                            </Label>
                            <div className="relative w-full aspect-square bg-gray-100 dark:bg-gray-700 rounded-xl overflow-hidden border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 transition-colors group">
                              {coverPreview ? (
                                <>
                                  <img 
                                    src={coverPreview} 
                                    alt="Cover" 
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.currentTarget;
                                      const retryCount = parseInt(target.dataset.retried || '0', 10);
                                      if (retryCount < 4) {
                                        target.dataset.retried = String(retryCount + 1);
                                        setTimeout(() => {
                                          if (coverPreview && !coverPreview.startsWith('data:')) {
                                            target.src = coverPreview + '?t=' + Date.now();
                                          }
                                        }, 1000 * (retryCount + 1));
                                      }
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <label className="cursor-pointer">
                                      <input
                                        type="file"
                                        accept="image/jpeg,image/jpg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            uploadCoverMutation.mutate(file);
                                          }
                                        }}
                                      />
                                      <Button type="button" size="sm" variant="secondary" asChild>
                                        <span className="flex items-center gap-1">
                                          <Upload className="h-4 w-4" />
                                          Alterar
                                        </span>
                                      </Button>
                                    </label>
                                  </div>
                                </>
                              ) : (
                                <label className="flex flex-col items-center justify-center h-full cursor-pointer">
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/jpg,image/png,image/webp"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        uploadCoverMutation.mutate(file);
                                      }
                                    }}
                                  />
                                  <Package className="h-16 w-16 text-gray-400 dark:text-gray-500 mb-2" />
                                  <span className="text-sm text-gray-500 dark:text-gray-400">Clique para enviar</span>
                                  <span className="text-xs text-gray-400 dark:text-gray-500 mt-1">PNG, JPG, WebP até 5MB</span>
                                </label>
                              )}
                            </div>
                            {uploadCoverMutation.isPending && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">Enviando imagem...</p>
                            )}
                          </div>

                          {/* Nome e Descrição */}
                          <div className="lg:col-span-2 space-y-4">
                            <FormField
                              control={basicInfoForm.control}
                              name="title"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Nome
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      maxLength={60}
                                      className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                                    />
                                  </FormControl>
                                  <FormDescription className="text-xs text-gray-500 dark:text-gray-400">
                                    Esse nome será exibido na vitrine e checkout - ({field.value?.length || 0}/60 caracteres)
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={basicInfoForm.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem>
                                  <div className="flex items-center justify-between">
                                    <FormLabel className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                      Descrição
                                    </FormLabel>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {field.value?.length || 0}/500 caracteres
                                    </span>
                                  </div>
                                  <FormControl>
                                    <Textarea
                                      {...field}
                                      maxLength={500}
                                      rows={4}
                                      className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {/* Categoria, Idioma, Moeda inline */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <FormField
                                control={basicInfoForm.control}
                                name="category"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                      Categoria
                                    </FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                      <FormControl>
                                        <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="apps">Apps</SelectItem>
                                        <SelectItem value="marketing">Marketing</SelectItem>
                                        <SelectItem value="business">Negócios</SelectItem>
                                        <SelectItem value="education">Educação</SelectItem>
                                        <SelectItem value="health">Saúde</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={basicInfoForm.control}
                                name="language"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                      Idioma
                                    </FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                      <FormControl>
                                        <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="pt">Português</SelectItem>
                                        <SelectItem value="en">Inglês</SelectItem>
                                        <SelectItem value="es">Espanhol</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={basicInfoForm.control}
                                name="currency"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                      Moeda
                                    </FormLabel>
                                    <Select value={field.value} onValueChange={field.onChange}>
                                      <FormControl>
                                        <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="BRL">BRL (R$)</SelectItem>
                                        <SelectItem value="USD">USD ($)</SelectItem>
                                        <SelectItem value="EUR">EUR (€)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Seção de Pixels de Rastreamento */}
            {activeSection === "pixels" && (
              <div className="space-y-6">
                {/* Barra de Busca e Botão */}
                <div className="flex items-center justify-center gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar"
                      value={pixelSearchQuery}
                      onChange={(e) => setPixelSearchQuery(e.target.value)}
                      className="pl-10 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                    />
                  </div>
                  <Button
                    onClick={() => setShowPixelPlatformModal(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Cadastrar pixel
                  </Button>
                </div>

                {/* Lista de Pixels */}
                {isLoadingPixels ? (
                  <Card className="bg-white dark:bg-transparent shadow-card">
                    <CardContent className="flex items-center justify-center py-20">
                      <p className="text-gray-500 dark:text-gray-400">Carregando pixels...</p>
                    </CardContent>
                  </Card>
                ) : pixelsData && pixelsData.pixels?.length > 0 ? (
                  <Card className="bg-white dark:bg-transparent shadow-card">
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        {pixelsData.pixels.map((pixel: any) => (
                          <div
                            key={pixel.id}
                            className="flex items-center justify-between p-3 border border-gray-200 dark:border-lime-500/20 rounded-lg hover:border-[#2563eb] dark:hover:border-lime-400 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded flex items-center justify-center">
                                {pixel.platform === 'google_ads' && <SiGoogleads className="h-5 w-5 text-[#4285F4]" />}
                                {pixel.platform === 'google_analytics_4' && <SiGoogleanalytics className="h-5 w-5 text-[#E37400]" />}
                                {pixel.platform === 'facebook' && <SiFacebook className="h-5 w-5 text-[#1877F2]" />}
                                {pixel.platform === 'tiktok' && <SiTiktok className="h-5 w-5 text-gray-900 dark:text-white" />}
                                {pixel.platform === 'kwai' && <div className="h-5 w-5 bg-orange-500 rounded text-white text-xs font-bold flex items-center justify-center">K</div>}
                                {pixel.platform === 'pinterest' && <SiPinterest className="h-5 w-5 text-[#E60023]" />}
                              </div>
                              <div>
                                <h3 className="text-sm font-medium text-gray-900 dark:text-white">{pixel.name}</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {pixel.platform === 'google_ads' && (pixel.conversionId || '')}
                                  {pixel.platform === 'google_analytics_4' && (pixel.measurementId || '')}
                                  {pixel.platform === 'facebook' && (pixel.pixelId || '')}
                                  {pixel.platform === 'tiktok' && (pixel.pixelId || '')}
                                  {pixel.platform === 'kwai' && (pixel.pixelId || '')}
                                  {pixel.platform === 'pinterest' && (pixel.tagId || '')}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={pixel.enabled} disabled className="scale-75" />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deletePixelMutation.mutate(pixel.id)}
                                disabled={deletePixelMutation.isPending}
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="bg-white dark:bg-transparent shadow-card">
                    <CardContent className="flex flex-col items-center justify-center py-20">
                      <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
                        <TrendingUp className="h-12 w-12 text-gray-400" />
                      </div>
                      <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        Você ainda não criou nenhum Pixel
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Cadastre o seu pixel.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Modal: Selecionar Plataforma - Compacto horizontal */}
                <Dialog open={showPixelPlatformModal} onOpenChange={setShowPixelPlatformModal}>
                  <DialogContent className="sm:max-w-[520px] bg-white dark:bg-gray-900 p-4">
                    <DialogHeader className="pb-2">
                      <DialogTitle className="text-base font-semibold text-gray-900 dark:text-white">
                        Cadastrar Pixel
                      </DialogTitle>
                    </DialogHeader>

                    <RadioGroup value={selectedPlatform} onValueChange={(value) => setSelectedPlatform(value as PlatformKey)} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'google_ads' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <SiGoogleads className="h-6 w-6 text-[#4285F4]" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Google Ads</span>
                        <RadioGroupItem value="google_ads" className="sr-only" />
                      </label>
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'google_analytics_4' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <SiGoogleanalytics className="h-6 w-6 text-[#E37400]" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">GA4</span>
                        <RadioGroupItem value="google_analytics_4" className="sr-only" />
                      </label>
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'facebook' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <SiFacebook className="h-6 w-6 text-[#1877F2]" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Facebook</span>
                        <RadioGroupItem value="facebook" className="sr-only" />
                      </label>
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'tiktok' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <SiTiktok className="h-6 w-6 text-gray-900 dark:text-white" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">TikTok</span>
                        <RadioGroupItem value="tiktok" className="sr-only" />
                      </label>
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'kwai' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <div className="h-6 w-6 bg-orange-500 rounded text-white text-xs font-bold flex items-center justify-center">K</div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Kwai</span>
                        <RadioGroupItem value="kwai" className="sr-only" />
                      </label>
                      <label className={`flex flex-col items-center gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${selectedPlatform === 'pinterest' ? 'border-[#2563eb] bg-blue-50 dark:bg-[#f0f4ff]/20' : 'border-gray-200 dark:border-lime-500/20 hover:border-lime-400'}`}>
                        <SiPinterest className="h-6 w-6 text-[#E60023]" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Pinterest</span>
                        <RadioGroupItem value="pinterest" className="sr-only" />
                      </label>
                    </RadioGroup>

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowPixelPlatformModal(false)}
                        className="flex-1 h-8 text-xs border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setCurrentPlatformForm(selectedPlatform);
                          setShowPixelPlatformModal(false);
                          setShowPixelFormModal(true);
                          setPixelName("");
                          setPixelCode("");
                          setPixelLabel("");
                          setPixelId("");
                          setPixelStatus(true);
                          setPixelEvents({
                            beginCheckout: false,
                            addPaymentInfo: false,
                            addToCart: false,
                            initiateCheckout: false,
                            purchase: false,
                          });
                        }}
                        className="flex-1 h-8 text-xs bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        Prosseguir
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* ❌ DIALOG ANTIGO DESABILITADO - Substituído por PixelFormDialog */}
                <Dialog open={false && showPixelFormModal && currentPlatformForm === "google_ads"} onOpenChange={setShowPixelFormModal}>
                  <DialogContent className="sm:max-w-[600px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                        Cadastrar Google Ads Pixel
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Preencha as informações.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 my-4">
                      {/* Nome */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">Nome</Label>
                        <Input
                          placeholder="Digite um nome"
                          value={pixelName}
                          onChange={(e) => setPixelName(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Código */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">Código</Label>
                        <Input
                          placeholder="Ex: AW-12152169945"
                          value={pixelCode}
                          onChange={(e) => setPixelCode(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Rótulo de conversão */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">Rótulo de conversão</Label>
                        <Input
                          placeholder="Ex: G4X1AO_Rl5wYEL-5_8Ap"
                          value={pixelLabel}
                          onChange={(e) => setPixelLabel(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Status */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-3 block">Status</Label>
                        <div className="flex items-center gap-3">
                          <Switch checked={pixelStatus} onCheckedChange={setPixelStatus} />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">Ativo</span>
                        </div>
                      </div>

                      {/* Configure eventos do pixel */}
                      <div className="pt-4 border-t border-gray-200 dark:border-lime-500/20">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                          Configure eventos do pixel
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                          Registro e otimização de conversões.
                        </p>

                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.beginCheckout}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, beginCheckout: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Iniciar finalização da compra (begin_checkout)
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.addPaymentInfo}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, addPaymentInfo: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Adicionar dados de pagamento (add_payment_info)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowPixelFormModal(false)}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={() => {
                          createPixelMutation.mutate({
                            platform: 'google_ads',
                            name: pixelName,
                            conversionId: pixelCode,
                            conversionLabel: pixelLabel,
                            enabled: pixelStatus,
                            events: {
                              pageView: true,
                              viewContent: true,
                              addToCart: pixelEvents.addToCart,
                              initiateCheckout: pixelEvents.initiateCheckout || pixelEvents.beginCheckout,
                              purchase: pixelEvents.purchase,
                            },
                          });
                        }}
                        disabled={createPixelMutation.isPending || !pixelName || !pixelCode || !pixelLabel}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {createPixelMutation.isPending ? 'Salvando...' : 'Adicionar Google Ads Pixel'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* ❌ DIALOG ANTIGO DESABILITADO - Substituído por PixelFormDialog */}
                <Dialog open={false && showPixelFormModal && currentPlatformForm === "facebook"} onOpenChange={setShowPixelFormModal}>
                  <DialogContent className="sm:max-w-[600px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                        Cadastrar Facebook Pixel
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Preencha as informações.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 my-4">
                      {/* Nome */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">Nome</Label>
                        <Input
                          placeholder="Digite um nome"
                          value={pixelName}
                          onChange={(e) => setPixelName(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Pixel ID */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">Pixel ID</Label>
                        <Input
                          placeholder="Ex: 5558764788570508"
                          value={pixelId}
                          onChange={(e) => setPixelId(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Status */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-3 block">Status</Label>
                        <div className="flex items-center gap-3">
                          <Switch checked={pixelStatus} onCheckedChange={setPixelStatus} />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">Ativo</span>
                        </div>
                      </div>

                      {/* Configure eventos do pixel */}
                      <div className="pt-4 border-t border-gray-200 dark:border-lime-500/20">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                          Configure eventos do pixel
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                          Registro e otimização de conversões.
                        </p>

                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.addToCart}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, addToCart: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Adicionar um item ao carrinho (AddToCart)
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.initiateCheckout}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, initiateCheckout: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Iniciar finalização da compra (InitiateCheckout)
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.addPaymentInfo}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, addPaymentInfo: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Adicionar dados de pagamento (AddPaymentInfo)
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={pixelEvents.purchase}
                              onCheckedChange={(checked) =>
                                setPixelEvents({ ...pixelEvents, purchase: checked })
                              }
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Compra (Purchase)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowPixelFormModal(false)}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={() => {
                          createPixelMutation.mutate({
                            platform: 'facebook',
                            name: pixelName,
                            pixelId: pixelId,
                            enabled: pixelStatus,
                            events: {
                              pageView: true,
                              viewContent: true,
                              addToCart: pixelEvents.addToCart,
                              initiateCheckout: pixelEvents.initiateCheckout,
                              addPaymentInfo: pixelEvents.addPaymentInfo,
                              purchase: pixelEvents.purchase,
                            },
                          });
                        }}
                        disabled={createPixelMutation.isPending || !pixelName || !pixelId}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {createPixelMutation.isPending ? 'Salvando...' : 'Adicionar Facebook Pixel'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* ✅ NOVO COMPONENTE UNIFICADO - Funciona para TODAS as 7 plataformas */}
                {currentPlatformForm && PIXEL_PLATFORM_CONFIG[currentPlatformForm as PlatformKey] && (
                  <PixelFormDialog
                    platform={currentPlatformForm as PlatformKey}
                    open={showPixelFormModal}
                    onOpenChange={setShowPixelFormModal}
                    onSubmit={(pixelData) => createPixelMutation.mutate(pixelData)}
                    isPending={createPixelMutation.isPending}
                  />
                )}
              </div>
            )}

            {/* Seção de Upsell, Cross Sell e Downsell */}
            {activeSection === "upsell" && (
              <div className="space-y-6">
                {/* Aviso quando não há checkout vinculado */}
                {!mainCheckoutId && (
                  <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-200 dark:border-yellow-700/40 bg-yellow-50 dark:bg-yellow-900/20">
                    <span className="text-yellow-600 dark:text-yellow-400 text-lg leading-none mt-0.5">⚠️</span>
                    <div>
                      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                        Crie uma oferta (checkout) para este produto primeiro
                      </p>
                      <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                        As estratégias de upsell e downsell são vinculadas a uma oferta. Vá até a aba <strong>Ofertas</strong> e crie uma oferta para habilitar esta funcionalidade.
                      </p>
                    </div>
                  </div>
                )}

                {/* Barra de Busca e Botão */}
                <div className="flex items-center justify-center gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar"
                      value={upsellSearchQuery}
                      onChange={(e) => setUpsellSearchQuery(e.target.value)}
                      className="pl-10 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                    />
                  </div>
                  <Button 
                    onClick={() => setShowUpsellModal(true)}
                    disabled={!mainCheckoutId}
                    title={!mainCheckoutId ? "Crie uma oferta para este produto primeiro" : undefined}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Adicionar estratégia
                  </Button>
                </div>

                {/* Texto Informativo */}
                <div className="text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Crie upsell e downsell para aumentar seu ticket médio.{" "}
                    <a href="#" className="text-blue-600 hover:text-blue-700 font-medium">
                      Saiba mais.
                    </a>
                  </p>
                </div>

                {/* Lista de Estratégias ou Estado Vazio */}
                {upsellStrategies.length > 0 ? (
                  <div className="space-y-3">
                    {upsellStrategies
                      .filter((s: any) =>
                        !upsellSearchQuery ||
                        s.name?.toLowerCase().includes(upsellSearchQuery.toLowerCase())
                      )
                      .map((strategy: any) => {
                        const linkedProduct = tenantProducts.find((p: any) => p.id === strategy.productId);
                        const productPrice = linkedProduct?.pricing?.amount
                          ? (linkedProduct.pricing.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : null;
                        return (
                          <Card key={strategy.id} className="bg-white dark:bg-transparent shadow-card border border-gray-200 dark:border-lime-500/20">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                                    strategy.type === 'upsell'
                                      ? 'bg-blue-100 dark:bg-blue-900/30'
                                      : 'bg-emerald-100 dark:bg-emerald-900/30'
                                  }`}>
                                    <TrendingUp className={`h-5 w-5 ${
                                      strategy.type === 'upsell'
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                    }`} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-semibold text-gray-900 dark:text-white truncate">
                                        {strategy.name}
                                      </span>
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        strategy.type === 'upsell'
                                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                      }`}>
                                        {strategy.type === 'upsell' ? 'Upsell' : 'Downsell'}
                                      </span>
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                      {strategy.offerType === 'product' && linkedProduct ? (
                                        <span>
                                          {linkedProduct.title}
                                          {productPrice && (
                                            <span className="ml-2 font-medium text-gray-700 dark:text-gray-300">
                                              {productPrice}
                                            </span>
                                          )}
                                        </span>
                                      ) : strategy.offerType === 'url' ? (
                                        <span className="text-blue-600 dark:text-blue-400 truncate">
                                          {strategy.customOfferUrl}
                                        </span>
                                      ) : (
                                        <span className="italic text-gray-400">Produto removido</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    strategy.active
                                      ? 'bg-blue-100 text-blue-700 dark:bg-green-900/30 dark:text-blue-400'
                                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                  }`}>
                                    {strategy.active ? 'Ativa' : 'Inativa'}
                                  </span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                  </div>
                ) : (
                  <Card className="bg-white dark:bg-transparent shadow-card">
                    <CardContent className="p-12">
                      <div className="flex flex-col items-center justify-center text-center space-y-4">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                          <TrendingUp className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                            Você ainda não criou nenhuma estratégia
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Crie estratégias para aumentar suas vendas.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Modal: Criar Estratégia */}
                <Dialog open={showUpsellModal} onOpenChange={setShowUpsellModal}>
                  <DialogContent className="sm:max-w-[600px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                        Criar estratégia
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Crie upsell ou downsell para aumentar seu ticket médio.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 my-4">
                      {/* Nome */}
                      <div>
                        <div className="flex items-center gap-1 mb-1">
                          <Label className="text-sm font-medium text-gray-900 dark:text-white">Nome</Label>
                          <span className="text-gray-400 dark:text-gray-500 cursor-help" title="Nome para identificar a estratégia">
                            ⓘ
                          </span>
                        </div>
                        <Input
                          placeholder="Ex: Oferta Premium"
                          value={strategyName}
                          onChange={(e) => setStrategyName(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Tipo de estratégia */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                          Tipo de estratégia
                        </Label>
                        <Select value={strategyType} onValueChange={setStrategyType}>
                          <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="upsell">Upsell</SelectItem>
                            <SelectItem value="downsell">Downsell</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Tipo de oferta: Produto ou URL */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                          Tipo de oferta
                        </Label>
                        <div className="flex gap-4">
                          <button
                            type="button"
                            onClick={() => setOfferType("product")}
                            className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                              offerType === "product"
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                                : "border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            <div className="text-sm font-medium">Produto</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Redirecionar para checkout
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setOfferType("url")}
                            className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                              offerType === "url"
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                                : "border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            <div className="text-sm font-medium">URL Customizada</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Redirecionar para qualquer página
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Selecione o produto (se tipo = produto) */}
                      {offerType === "product" && (
                        <div>
                          <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                            Selecione o produto
                          </Label>
                          <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                            <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                              <SelectValue placeholder="Selecione um produto" />
                            </SelectTrigger>
                            <SelectContent>
                              {isLoadingProducts ? (
                                <SelectItem value="loading" disabled>
                                  Carregando produtos...
                                </SelectItem>
                              ) : tenantProducts.length === 0 ? (
                                <SelectItem value="empty" disabled>
                                  Nenhum produto encontrado
                                </SelectItem>
                              ) : (
                                tenantProducts.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.title}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* URL customizada da oferta (se tipo = url) */}
                      {offerType === "url" && (
                        <div>
                          <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                            URL da oferta
                          </Label>
                          <Input
                            placeholder="https://www.seusite.com/oferta-especial"
                            value={customOfferUrl}
                            onChange={(e) => setCustomOfferUrl(e.target.value)}
                            className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                          />
                        </div>
                      )}

                      {/* Caso o cliente aceite a oferta */}
                      <div className="border border-gray-200 dark:border-lime-500/20 rounded-lg p-4 space-y-4">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Caso o cliente aceite a oferta
                        </h4>

                        {/* Ação */}
                        <div>
                          <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                            Ação
                          </Label>
                          <Select value={acceptAction} onValueChange={setAcceptAction}>
                            <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nova-oferta">Nova oferta (outro upsell/downsell)</SelectItem>
                              <SelectItem value="url-customizada">URL customizada</SelectItem>
                              <SelectItem value="pagina-obrigado">Página de obrigado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Próximo produto (se nova-oferta) */}
                        {acceptAction === "nova-oferta" && (
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Próxima oferta
                            </Label>
                            <Select value={acceptNextProduct} onValueChange={setAcceptNextProduct}>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                <SelectValue placeholder="Selecione o próximo produto" />
                              </SelectTrigger>
                              <SelectContent>
                                {tenantProducts
                                  .filter(p => p.id !== selectedProduct)
                                  .map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                      {product.title}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* URL customizada */}
                        {acceptAction === "url-customizada" && (
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              URL de redirecionamento
                            </Label>
                            <Input
                              placeholder="https://www.seusite.com/obrigado"
                              value={acceptUrl}
                              onChange={(e) => setAcceptUrl(e.target.value)}
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                            />
                          </div>
                        )}

                        {acceptAction === "pagina-obrigado" && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            O cliente será redirecionado para a página de obrigado padrão.
                          </p>
                        )}
                      </div>

                      {/* Se recusar */}
                      <div className="border border-gray-200 dark:border-lime-500/20 rounded-lg p-4 space-y-4">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Se recusar
                        </h4>

                        {/* Ação */}
                        <div>
                          <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                            Ação
                          </Label>
                          <Select value={refuseAction} onValueChange={setRefuseAction}>
                            <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="nova-oferta">Nova oferta (outro upsell/downsell)</SelectItem>
                              <SelectItem value="url-customizada">URL customizada</SelectItem>
                              <SelectItem value="pagina-obrigado">Página de obrigado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Próximo produto (se nova-oferta) */}
                        {refuseAction === "nova-oferta" && (
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Próxima oferta
                            </Label>
                            <Select value={refuseNextProduct} onValueChange={setRefuseNextProduct}>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                <SelectValue placeholder="Selecione o próximo produto" />
                              </SelectTrigger>
                              <SelectContent>
                                {tenantProducts
                                  .filter(p => p.id !== selectedProduct)
                                  .map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                      {product.title}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* URL customizada */}
                        {refuseAction === "url-customizada" && (
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              URL de redirecionamento
                            </Label>
                            <Input
                              placeholder="https://www.seusite.com/obrigado"
                              value={refuseUrl}
                              onChange={(e) => setRefuseUrl(e.target.value)}
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                            />
                          </div>
                        )}

                        {refuseAction === "pagina-obrigado" && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            O cliente será redirecionado para a página de obrigado padrão.
                          </p>
                        )}
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowUpsellModal(false);
                          // Resetar formulário
                          setStrategyName("");
                          setStrategyType("upsell");
                          setOfferType("product");
                          setSelectedProduct("");
                          setCustomOfferUrl("");
                          setAcceptAction("pagina-obrigado");
                          setAcceptUrl("");
                          setAcceptNextProduct("");
                          setRefuseAction("pagina-obrigado");
                          setRefuseUrl("");
                          setRefuseNextProduct("");
                        }}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={() => {
                          // Validação de campos obrigatórios
                          if (!strategyName.trim()) {
                            toast({ title: "Nome da estratégia é obrigatório", variant: "destructive" });
                            return;
                          }

                          // Validar oferta baseado no tipo selecionado
                          if (offerType === "product" && !selectedProduct) {
                            toast({ title: "Selecione um produto para a oferta", variant: "destructive" });
                            return;
                          }
                          if (offerType === "url" && !customOfferUrl.trim()) {
                            toast({ title: "Informe a URL da oferta", variant: "destructive" });
                            return;
                          }

                          // Validar ação de aceitação
                          if (acceptAction === "nova-oferta" && !acceptNextProduct) {
                            toast({ title: "Selecione o próximo produto para quando aceitar", variant: "destructive" });
                            return;
                          }
                          if (acceptAction === "url-customizada" && !acceptUrl.trim()) {
                            toast({ title: "Informe a URL para quando aceitar", variant: "destructive" });
                            return;
                          }

                          // Validar ação de recusa
                          if (refuseAction === "nova-oferta" && !refuseNextProduct) {
                            toast({ title: "Selecione o próximo produto para quando recusar", variant: "destructive" });
                            return;
                          }
                          if (refuseAction === "url-customizada" && !refuseUrl.trim()) {
                            toast({ title: "Informe a URL para quando recusar", variant: "destructive" });
                            return;
                          }

                          // Salvar estratégia
                          saveStrategyMutation.mutate({
                            name: strategyName,
                            type: strategyType,
                            offerType: offerType,
                            productId: offerType === "product" ? selectedProduct : undefined,
                            customOfferUrl: offerType === "url" ? customOfferUrl : undefined,
                            onAccept: {
                              action: acceptAction,
                              nextProductId: acceptAction === "nova-oferta" ? acceptNextProduct : undefined,
                              url: acceptAction === "url-customizada" ? acceptUrl : undefined,
                            },
                            onRefuse: {
                              action: refuseAction,
                              nextProductId: refuseAction === "nova-oferta" ? refuseNextProduct : undefined,
                              url: refuseAction === "url-customizada" ? refuseUrl : undefined,
                            },
                          });
                        }}
                        disabled={saveStrategyMutation.isPending}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        {saveStrategyMutation.isPending ? "Salvando..." : "Cadastrar estratégia"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Seção de Cupons */}
            {activeSection === "cupons" && (
              <div className="space-y-6">
                {/* Barra de Busca e Botão */}
                <div className="flex items-center justify-center gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar"
                      value={couponSearchQuery}
                      onChange={(e) => setCouponSearchQuery(e.target.value)}
                      className="pl-10 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                    />
                  </div>
                  <Button 
                    onClick={() => setShowCouponModal(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                  >
                    Adicionar desconto
                  </Button>
                </div>

                {/* Tabela de Cupons */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="border-b border-gray-200 dark:border-lime-500/20">
                          <tr>
                            <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                              Nome
                            </th>
                            <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                              Desconto
                            </th>
                            <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                              Código
                            </th>
                            <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                              Status
                            </th>
                            <th className="w-20"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {coupons.length === 0 && !isLoadingCoupons && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                Nenhum cupom criado ainda
                              </td>
                            </tr>
                          )}
                          {isLoadingCoupons && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                                Carregando cupons...
                              </td>
                            </tr>
                          )}
                          {coupons.map((coupon) => (
                            <tr key={coupon.id} className="border-b border-gray-100 dark:border-lime-500/20 last:border-0">
                              <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                {coupon.name || coupon.code}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                                    {coupon.type === 'percentage' 
                                      ? `${coupon.value}%` 
                                      : `R$ ${(coupon.value / 100).toFixed(2).replace('.', ',')}`
                                    }
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {coupon.type === 'percentage' ? 'Porcentagem' : 'Valor fixo'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                                    {coupon.code}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {coupon.validUntil 
                                      ? `Expira: ${new Date(coupon.validUntil).toLocaleDateString('pt-BR')}`
                                      : 'Sem expiração'
                                    }
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <Switch 
                                    checked={coupon.active} 
                                    onCheckedChange={async (checked) => {
                                      try {
                                        const token = await auth.currentUser?.getIdToken();
                                        await fetch(`/api/products/${id}/coupons/${coupon.id}`, {
                                          method: 'PUT',
                                          headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`,
                                          },
                                          body: JSON.stringify({ active: checked }),
                                        });
                                        refetchCoupons();
                                        toast({
                                          title: checked ? "Cupom ativado!" : "Cupom desativado!",
                                        });
                                      } catch (error) {
                                        console.error('Erro ao atualizar cupom:', error);
                                      }
                                    }}
                                  />
                                  <span className="text-sm text-gray-900 dark:text-white">
                                    {coupon.active ? 'Ativo' : 'Inativo'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                                    <Edit className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                                  </button>
                                  <button 
                                    onClick={() => setDeleteCouponTarget(coupon.id)}
                                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                  >
                                    <Trash2 className="h-4 w-4 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Modal: Novo Desconto */}
                <Dialog open={showCouponModal} onOpenChange={setShowCouponModal}>
                  <DialogContent className="sm:max-w-[600px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-bold text-gray-900 dark:text-white">
                        Novo Desconto
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Configure um cupom de desconto e aumente as conversões da sua loja, capte novos compradores e incentive a conclusão da compra.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 my-4">
                      {/* Nome */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                          Nome
                        </Label>
                        <Input
                          placeholder="Digite um nome"
                          value={couponName}
                          onChange={(e) => setCouponName(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Código de Cupom */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                          Código de Cupom
                        </Label>
                        <Input
                          placeholder="DESCONTO10"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Regras para aplicação de cupom */}
                      <div className="border border-gray-200 dark:border-lime-500/20 rounded-lg p-4 space-y-4">
                        <h4 className="text-base font-semibold text-gray-900 dark:text-white">
                          Regras para aplicação de cupom
                        </h4>

                        {/* Selecione a unidade */}
                        <div>
                          <Label className="text-sm font-medium text-gray-900 dark:text-white mb-3 block">
                            Selecione a unidade
                          </Label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button
                              onClick={() => setCouponUnit("valor")}
                              className={`flex items-center justify-center gap-2 px-4 py-3 border-2 rounded-lg transition-colors ${
                                couponUnit === "valor"
                                  ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                                  : "border-gray-200 dark:border-lime-500/20"
                              }`}
                            >
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                couponUnit === "valor"
                                  ? "border-blue-600"
                                  : "border-gray-300 dark:border-gray-600"
                              }`}>
                                {couponUnit === "valor" && (
                                  <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                                )}
                              </div>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                Valor em R$
                              </span>
                            </button>

                            <button
                              onClick={() => setCouponUnit("porcentagem")}
                              className={`flex items-center justify-center gap-2 px-4 py-3 border-2 rounded-lg transition-colors ${
                                couponUnit === "porcentagem"
                                  ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                                  : "border-gray-200 dark:border-lime-500/20"
                              }`}
                            >
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                couponUnit === "porcentagem"
                                  ? "border-blue-600"
                                  : "border-gray-300 dark:border-gray-600"
                              }`}>
                                {couponUnit === "porcentagem" && (
                                  <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                                )}
                              </div>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                Porcentagem
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Desconto de e Valor mínimo */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Desconto de
                            </Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600 dark:text-gray-400 font-medium px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-lime-500/20 rounded-l-md">
                                {couponUnit === 'porcentagem' ? '%' : 'R$'}
                              </span>
                              <Input
                                placeholder={couponUnit === 'porcentagem' ? "10" : "0,00"}
                                value={couponDiscount}
                                onChange={(e) => setCouponDiscount(e.target.value)}
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 rounded-l-none flex-1"
                              />
                            </div>
                          </div>

                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Valor mínimo da compra
                            </Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600 dark:text-gray-400 font-medium px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-lime-500/20 rounded-l-md">
                                R$
                              </span>
                              <Input
                                placeholder="0,00"
                                value={couponMinValue}
                                onChange={(e) => setCouponMinValue(e.target.value)}
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 rounded-l-none flex-1"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Data de expiração */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Data de expiração
                            </Label>
                            <Input
                              type="date"
                              value={couponExpDate}
                              onChange={(e) => setCouponExpDate(e.target.value)}
                              disabled={couponNoExpiration}
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 disabled:opacity-50"
                            />
                          </div>
                          <div className="flex items-center gap-2 pb-2">
                            <Switch 
                              checked={couponNoExpiration} 
                              onCheckedChange={setCouponNoExpiration}
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Não vence
                            </span>
                          </div>
                        </div>

                        {/* Limite de uso */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                          <div>
                            <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                              Limite de uso
                            </Label>
                            <Input
                              type="number"
                              placeholder=""
                              value={couponUsageLimit}
                              onChange={(e) => setCouponUsageLimit(e.target.value)}
                              disabled={couponNoLimit}
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 disabled:opacity-50"
                            />
                          </div>
                          <div className="flex items-center gap-2 pb-2">
                            <Switch 
                              checked={couponNoLimit} 
                              onCheckedChange={setCouponNoLimit}
                            />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Não há limite
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowCouponModal(false)}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleSaveCoupon}
                        disabled={savingCoupon}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        {savingCoupon ? "Salvando..." : "Criar Cupom"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Seção de Afiliação - CONFIGURAÇÃO DO SELLER */}
            {activeSection === "afiliacao" && (
              <div className="space-y-6">
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-6 space-y-6">
                    {/* ATIVAR/DESATIVAR PROGRAMA DE AFILIADOS */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-200 dark:border-lime-500/20 gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          Programa de Afiliados
                        </h3>
                        {affiliatesEnabled && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Configure as comissões e regras para afiliados
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {affiliatesEnabled && (
                          <>
                            <button
                              onClick={() => setAffiliateSubTab('config')}
                              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                affiliateSubTab === 'config'
                                  ? 'bg-blue-100 text-[#2563eb] dark:bg-[#f0f4ff]/30 dark:text-blue-400'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
                              }`}
                            >
                              Configurações
                            </button>
                            <button
                              onClick={() => setAffiliateSubTab('manage')}
                              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                affiliateSubTab === 'manage'
                                  ? 'bg-blue-100 text-[#2563eb] dark:bg-[#f0f4ff]/30 dark:text-blue-400'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
                              }`}
                            >
                              Gerenciar Afiliados
                            </button>
                          </>
                        )}
                        <Switch
                          checked={affiliatesEnabled}
                          onCheckedChange={(checked) => {
                            // Se estiver DESATIVANDO (checked = false), mostrar alerta
                            if (!checked && affiliatesEnabled) {
                              setShowDisableAffiliateAlert(true);
                            } else {
                              // Se estiver ATIVANDO, permitir diretamente
                              setAffiliatesEnabled(checked);
                            }
                          }}
                        />
                      </div>
                    </div>

                    {affiliatesEnabled && (
                      <>
                        {/* ABA CONFIGURAÇÕES */}
                        {affiliateSubTab === 'config' && (
                          <>
                            {/* APROVAÇÃO AUTOMÁTICA */}
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                  Aprovação automática
                                </Label>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                  Afiliados são aprovados automaticamente sem necessidade de revisão
                                </p>
                              </div>
                              <Switch
                                checked={autoApprove}
                                onCheckedChange={setAutoApprove}
                              />
                            </div>

                            {/* COMISSÃO PARA OFERTAS ÚNICAS */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Comissão para ofertas únicas (%)
                              </Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={singleCommission}
                                onChange={(e) => setSingleCommission(e.target.value)}
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                            </div>

                            {/* COMISSÃO PARA RECORRENTES */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Comissão para ofertas recorrentes (%)
                              </Label>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={recurringCommission}
                                onChange={(e) => setRecurringCommission(e.target.value)}
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                            </div>

                            {/* TIPO DE COMISSÃO RECORRENTE */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Aplicar comissão recorrente em
                              </Label>
                              <Select value={commissionType} onValueChange={setCommissionType}>
                                <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="todas">Todas as cobranças</SelectItem>
                                  <SelectItem value="primeira">Primeira cobrança apenas</SelectItem>
                                  <SelectItem value="fixo">Número fixo de cobranças</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* COMISSÃO ESTENDIDA */}
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                  Comissão estendida
                                </Label>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                  Aplicar comissão também em cross-sell, upsell, downsell e order bump
                                </p>
                              </div>
                              <Switch
                                checked={extendCommission}
                                onCheckedChange={setExtendCommission}
                              />
                            </div>

                            {/* MARKETPLACE */}
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                  Exibir no marketplace
                                </Label>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                  Permitir que afiliados encontrem este produto na vitrine
                                </p>
                              </div>
                              <Switch
                                checked={marketplaceEnabled}
                                onCheckedChange={setMarketplaceEnabled}
                              />
                            </div>

                            {/* DURAÇÃO DO COOKIE */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Duração do cookie (dias)
                              </Label>
                              <Input
                                type="number"
                                min="1"
                                max="365"
                                value={cookieDuration}
                                onChange={(e) => setCookieDuration(e.target.value)}
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                              <p className="text-xs text-gray-600 dark:text-gray-400">
                                Por quantos dias o afiliado receberá comissão após o primeiro clique
                              </p>
                            </div>

                            {/* SELEÇÃO DE OFERTAS */}
                            <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-lime-500/20">
                            <div className="flex items-start justify-between">
                              <div className="space-y-2">
                                <h4 className="text-md font-semibold text-gray-900 dark:text-white">
                                  Ofertas
                                </h4>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                  Selecione as ofertas específicas para afiliados, ou deixe vazio para permitir todas as ofertas.
                                </p>
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                                  <p className="text-xs font-medium text-blue-900 dark:text-blue-100">
                                    💡 Dica: Se nenhuma oferta for selecionada, TODAS as ofertas estarão disponíveis para os afiliados.
                                  </p>
                                </div>
                              </div>
                              {selectedOffers.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedOffers([])}
                                  className="text-blue-600 hover:text-blue-700 text-xs"
                                >
                                  (Desmarcar todas)
                                </Button>
                              )}
                            </div>
  
                            {allOffersForAffiliate.length === 0 ? (
                              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 text-center border border-dashed border-gray-300 dark:border-gray-600">
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  Nenhum checkout criado ainda. Crie checkouts para disponibilizá-los no marketplace.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {allOffersForAffiliate.map((offer: any) => {
                                  const isSelected = selectedOffers.includes(offer.id);
                                  const commission = parseFloat(singleCommission) || 10;
                                  const offerPrice = (offer.pricing?.amount || 0) / 100;
                                  
                                  // 💰 CALCULAR TAXAS REAIS BASEADO NO MÉTODO DE PAGAMENTO
                                  let realTaxes = 0;
                                  if (paymentFees && offerPrice > 0) {
                                    // Determinar método de pagamento padrão da oferta (PIX tem prioridade)
                                    const paymentMethods = offer.pricing?.paymentMethods || {};
                                    
                                    if (paymentMethods.pix) {
                                      // PIX: Taxa fixa + percentual
                                      realTaxes = (paymentFees.pixFixedFee / 100) + (offerPrice * paymentFees.pixPercentFee / 100);
                                    } else if (paymentMethods.creditCard) {
                                      // Cartão de Crédito BR: Taxa fixa + percentual
                                      realTaxes = (paymentFees.creditCardBRFixedFee / 100) + (offerPrice * paymentFees.creditCardBRPercentFee / 100);
                                    } else if (paymentMethods.boleto) {
                                      // Boleto: Taxa fixa + percentual
                                      realTaxes = (paymentFees.boletoFixedFee / 100) + (offerPrice * paymentFees.boletoPercentFee / 100);
                                    } else {
                                      // Fallback para cartão BR se nenhum método especificado
                                      realTaxes = (paymentFees.creditCardBRFixedFee / 100) + (offerPrice * paymentFees.creditCardBRPercentFee / 100);
                                    }
                                  } else {
                                    // Fallback: 8% se taxas não carregaram
                                    realTaxes = offerPrice * 0.08;
                                  }
                                  
                                  const affiliateReceives = offerPrice * (commission / 100);
                                  const sellerReceives = offerPrice - realTaxes - affiliateReceives;
  
                                  return (
                                    <div
                                      key={offer.id}
                                      className={`border rounded-lg p-4 cursor-pointer transition-all ${
                                        isSelected
                                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                                          : 'border-gray-200 dark:border-lime-500/20 hover:border-gray-300 dark:hover:border-gray-600'
                                      }`}
                                      onClick={() => {
                                        if (isSelected) {
                                          setSelectedOffers(selectedOffers.filter(id => id !== offer.id));
                                        } else {
                                          setSelectedOffers([...selectedOffers, offer.id]);
                                        }
                                      }}
                                    >
                                      <div className="flex items-start gap-3">
                                        <Checkbox
                                          checked={isSelected}
                                          onCheckedChange={(checked) => {
                                            if (checked) {
                                              setSelectedOffers([...selectedOffers, offer.id]);
                                            } else {
                                              setSelectedOffers(selectedOffers.filter(id => id !== offer.id));
                                            }
                                          }}
                                          className="mt-1"
                                        />
                                        <div className="flex-1">
                                          <div className="flex items-center justify-between">
                                            <h5 className="font-semibold text-gray-900 dark:text-white">
                                              {offer.title || 'Oferta sem nome'}
                                            </h5>
                                            <div className="text-right">
                                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {productData?.productType === 'subscription' ? (
                                                  <>
                                                    {offer.pricing?.subscriptionPeriod === 'monthly' && 'Mensal'}
                                                    {offer.pricing?.subscriptionPeriod === 'quarterly' && 'Trimestral'}
                                                    {offer.pricing?.subscriptionPeriod === 'semiannual' && 'Semestral'}
                                                    {offer.pricing?.subscriptionPeriod === 'annual' && 'Anual'}
                                                    {!offer.pricing?.subscriptionPeriod && 'Mensal'}
                                                  </>
                                                ) : (
                                                  'Pagamento Único'
                                                )}
                                              </p>
                                              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {new Intl.NumberFormat('pt-BR', {
                                                  style: 'currency',
                                                  currency: 'BRL'
                                                }).format(offerPrice)}
                                              </p>
                                            </div>
                                          </div>
                                          
                                          {isSelected && (
                                            <div className="mt-3 space-y-1 text-xs">
                                              <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">Taxas</span>
                                                <span className="text-red-600 dark:text-red-400 font-medium">
                                                  {new Intl.NumberFormat('pt-BR', {
                                                    style: 'currency',
                                                    currency: 'BRL'
                                                  }).format(realTaxes)}
                                                </span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">Você recebe</span>
                                                <span className="text-[#2563eb] dark:text-blue-400 font-medium">
                                                  {new Intl.NumberFormat('pt-BR', {
                                                    style: 'currency',
                                                    currency: 'BRL'
                                                  }).format(sellerReceives)}
                                                </span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600 dark:text-gray-400">Afiliado recebe</span>
                                                <span className="text-blue-600 dark:text-blue-400 font-medium">
                                                  {new Intl.NumberFormat('pt-BR', {
                                                    style: 'currency',
                                                    currency: 'BRL'
                                                  }).format(affiliateReceives)}
                                                </span>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
  
                          {/* DADOS DE SUPORTE */}
                          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-lime-500/20">
                            <h4 className="text-md font-semibold text-gray-900 dark:text-white">
                              Suporte ao afiliado
                            </h4>
                            
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Nome do responsável <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                value={supportName}
                                onChange={(e) => setSupportName(e.target.value)}
                                placeholder="Ex: João Silva"
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                            </div>
  
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                E-mail de suporte <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                type="email"
                                value={supportEmail}
                                onChange={(e) => setSupportEmail(e.target.value)}
                                placeholder="suporte@empresa.com"
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                            </div>
  
                            <div className="space-y-2">
                              <Label className="text-sm font-medium text-gray-900 dark:text-white">
                                Telefone de suporte <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                value={supportPhone}
                                onChange={(e) => setSupportPhone(e.target.value)}
                                placeholder="(11) 99999-9999"
                                className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                              />
                            </div>
                          </div>
  
                          {/* PÁGINA DE VENDAS */}
                          <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-900 dark:text-white">
                              Página de vendas (URL)
                            </Label>
                            <Input
                              type="url"
                              value={affiliateSalesPage}
                              onChange={(e) => setAffiliateSalesPage(e.target.value)}
                              placeholder="https://seusite.com/vendas"
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                            />
                          </div>
  
                          {/* REGRAS DO PROGRAMA */}
                          <div className="space-y-2">
                            <Label className="text-sm font-medium text-gray-900 dark:text-white">
                              Regras do programa de afiliados
                            </Label>
                            <Textarea
                              value={affiliateRules}
                              onChange={(e) => setAffiliateRules(e.target.value)}
                              placeholder="Descreva as regras e condições do seu programa de afiliados..."
                              rows={5}
                              maxLength={1000}
                              className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                            />
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              {affiliateRules.length}/1000 caracteres
                            </p>
                          </div>
  
                            {/* BOTÃO SALVAR */}
                            <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-lime-500/20">
                              <Button
                                onClick={handleSaveAffiliateSettings}
                                className="bg-[#2563eb] hover:bg-[#9FCC3B] text-black font-medium"
                              >
                                Salvar configurações
                              </Button>
                            </div>
                          </>
                        )}

                        {/* ABA GERENCIAR AFILIADOS */}
                        {affiliateSubTab === 'manage' && mainCheckoutId && (
                          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-lime-500/20">
                            <AffiliateManagement 
                              checkoutId={mainCheckoutId}
                              sellerId={tenantId!}
                              defaultCommission={parseFloat(singleCommission || '0')}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Seção de Coprodução */}
            {activeSection === "coproducao" && (
              <div className="space-y-6">
                {/* Cabeçalho com abas */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                          Coprodução
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Convide parceiros para coproduzirem e compartilharem lucros
                        </p>
                      </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex items-center gap-2 border-b border-gray-200 dark:border-lime-500/20">
                      <button
                        onClick={() => setCoproductionTab('invite')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          coproductionTab === 'invite'
                            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                      >
                        Enviar Convite
                      </button>
                      <button
                        onClick={() => setCoproductionTab('manage')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          coproductionTab === 'manage'
                            ? 'border-[#2563eb] text-[#2563eb] dark:border-lime-400 dark:text-blue-400'
                            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                      >
                        Gerenciar Coprodutores
                      </button>
                    </div>
                  </CardContent>
                </Card>

                {/* Conteúdo das abas */}
                {coproductionTab === 'invite' && mainCheckoutId && (
                  <CoproductionInvite 
                    checkoutId={mainCheckoutId} 
                    productName={productData?.title || 'Produto'}
                  />
                )}

                {coproductionTab === 'manage' && mainCheckoutId && (
                  <CoproductionManagement checkoutId={mainCheckoutId} />
                )}
              </div>
            )}
            {activeSection === "apagar-produto" && (
              <div className="space-y-6">
                <Card className="bg-red-600 dark:bg-red-700 border-2 border-red-700 dark:border-red-800 mx-0 sm:mx-4">
                  <CardContent className="p-4 sm:p-8">
                    <div className="max-w-2xl mx-auto text-center space-y-6">
                      <div className="w-16 h-16 mx-auto bg-white/20 rounded-full flex items-center justify-center">
                        <Trash2 className="h-8 w-8 text-white" />
                      </div>
                      
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-white">
                          Zona de Perigo
                        </h3>
                        <p className="text-base text-white/90">
                          Esta ação é permanente e não pode ser desfeita
                        </p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 sm:p-6 space-y-3 text-left border border-white/20">
                        <h4 className="font-semibold text-white mb-3">
                          O que acontecerá ao apagar este produto:
                        </h4>
                        <div className="space-y-2 text-sm text-white/90">
                          <div className="flex items-start gap-2">
                            <span className="text-white mt-0.5">✗</span>
                            <span>O produto será <strong className="text-white font-bold">removido permanentemente</strong> e não poderá mais ser vendido</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white mt-0.5">✗</span>
                            <span>Todos os checkouts vinculados serão <strong className="text-white font-bold">desativados</strong></span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-white mt-0.5">✗</span>
                            <span>Links de venda <strong className="text-white font-bold">deixarão de funcionar</strong></span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-[#2563eb] mt-0.5">✓</span>
                            <span>O <strong className="text-white font-bold">histórico de vendas será mantido</strong> para fins contábeis</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-[#2563eb] mt-0.5">✓</span>
                            <span>Saldos e transações <strong className="text-white font-bold">serão preservados</strong></span>
                          </div>
                        </div>
                      </div>

                      <Button
                        onClick={() => setShowDeleteProductModal(true)}
                        disabled={isDeletingProduct}
                        className="bg-white hover:bg-gray-100 text-red-600 font-bold px-8 py-3 text-base h-auto w-full sm:w-auto border-2 border-white shadow-lg"
                        data-testid="button-delete-product"
                      >
                        <Trash2 className="h-5 w-5 mr-2" />
                        {isDeletingProduct ? "Apagando..." : "Apagar Produto Permanentemente"}
                      </Button>
                      
                      <p className="text-xs text-white/70">
                        Esta ação é irreversível. Por favor, tenha certeza absoluta antes de continuar.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Seção de Área de Membros - Alunos */}
            {activeSection === "alunos" && (
              <div className="space-y-6">
                {/* Header do Produto */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 sm:gap-4">
                        {/* Ícone do Produto */}
                        <div className="w-14 h-14 sm:w-20 sm:h-20 bg-gray-900 dark:bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-10 h-10 text-white dark:text-gray-900" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                          </svg>
                        </div>
                        
                        {/* Informações do Produto */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full border border-blue-200 dark:border-blue-700">
                              Curso
                            </span>
                          </div>
                          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            {productName}
                          </h2>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Barra de ações */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                  {/* Pré-visualização */}
                  <Button 
                    variant="outline"
                    className="border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 w-full sm:w-auto"
                  >
                    Pré-visualização
                    <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Button>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 flex-1 sm:justify-end">
                    {/* Campo de busca */}
                    <div className="relative flex-1 sm:max-w-md">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        type="text"
                        placeholder="Buscar aluno"
                        value={classSearchQuery}
                        onChange={(e) => setClassSearchQuery(e.target.value)}
                        className="pl-10 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                      />
                    </div>

                    {/* Botão Adicionar membro */}
                    <Button 
                      onClick={() => setShowAddMemberModal(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                    >
                      Adicionar membro
                    </Button>
                  </div>
                </div>

                {/* Tabela de Alunos */}
                <Card className="bg-white dark:bg-transparent shadow-card">
                  <CardContent className="p-0">
                    {/* Barra de ações da tabela */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-lime-500/20">
                      <div className="flex items-center gap-3">
                        <Button variant="ghost" className="text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </Button>
                      </div>
                      
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Alunos <span className="font-semibold text-gray-900 dark:text-white ml-1">0</span>
                      </div>
                    </div>

                    {/* Cabeçalho da tabela */}
                    <div className="grid grid-cols-[50px_1fr_120px_120px_140px_50px] gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-lime-500/20">
                      <div>
                        <Checkbox />
                      </div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Nome
                      </div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase flex items-center gap-1">
                        Conclusão
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                        </svg>
                      </div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase flex items-center gap-1">
                        Alunos
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                        </svg>
                      </div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase flex items-center gap-1">
                        Data Entrada
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                        </svg>
                      </div>
                      <div></div>
                    </div>

                    {/* Estado vazio - nenhum aluno ainda */}
                    <div className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                          <svg className="w-8 h-8 text-gray-400 dark:text-gray-600" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                          </svg>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Nenhum aluno cadastrado ainda
                        </p>
                        <Button 
                          onClick={() => setShowAddMemberModal(true)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                        >
                          Adicionar primeiro membro
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Modal: Adicionar Membro */}
                <Dialog open={showAddMemberModal} onOpenChange={setShowAddMemberModal}>
                  <DialogContent className="sm:max-w-[500px] bg-white dark:bg-transparent">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                        Adicionar Membro
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Adicione um novo membro ao curso preenchendo os dados abaixo.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                      {/* Nome */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">
                          Nome completo <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="text"
                          placeholder="Digite o nome completo"
                          value={memberName}
                          onChange={(e) => setMemberName(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Email */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">
                          E-mail <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="email"
                          placeholder="exemplo@email.com"
                          value={memberEmail}
                          onChange={(e) => setMemberEmail(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* WhatsApp */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white">
                          WhatsApp <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="tel"
                          placeholder="+55 (11) 99999-9999"
                          value={memberWhatsapp}
                          onChange={(e) => setMemberWhatsapp(e.target.value)}
                          className="mt-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowAddMemberModal(false);
                          setMemberName("");
                          setMemberEmail("");
                          setMemberWhatsapp("");
                        }}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={() => {
                          // Aqui virá a lógica de adicionar membro
                          setShowAddMemberModal(false);
                          setMemberName("");
                          setMemberEmail("");
                          setMemberWhatsapp("");
                        }}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        <span className="mr-2">✓</span>
                        Adicionar
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Seção de Área de Membros - Aulas */}
            {activeSection === "aulas" && (
              <div className="space-y-6">
                {/* Barra de ações superior */}
                <div className="flex items-center justify-between gap-4">
                  {/* Pré-visualizar */}
                  <Button 
                    variant="ghost"
                    onClick={() => {
                      window.open(`/members/${id}`, '_blank');
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    Pré-visualizar
                    <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Button>

                  <div className="flex items-center gap-4 flex-1 justify-end">
                    {/* Campo de busca */}
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        type="text"
                        placeholder="Buscar..."
                        value={modulesSearchQuery}
                        onChange={(e) => setModulesSearchQuery(e.target.value)}
                        className="pl-10 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                      />
                    </div>

                    {/* Botão Criar módulo */}
                    <Button 
                      onClick={() => setShowCreateModuleModal(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                    >
                      Criar módulo
                    </Button>
                  </div>
                </div>

                {/* Lista de módulos - DINÂMICA DO FIREBASE */}
                {modules.length === 0 && !loadingModules ? (
                  <Card className="bg-white dark:bg-transparent shadow-card">
                    <CardContent className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                          <svg className="w-8 h-8 text-gray-400 dark:text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Nenhum módulo criado ainda
                        </p>
                        <Button 
                          onClick={() => setShowCreateModuleModal(true)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                        >
                          Criar primeiro módulo
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  modules.map((module) => (
                    <ModuleCard 
                      key={module.id}
                      module={module}
                      productId={id}
                      onDeleteModule={handleDeleteModule}
                      onDeleteLesson={handleDeleteLesson}
                      onAddLesson={(moduleId: string) => {
                        setCurrentModuleId(moduleId);
                        setShowAddLessonModal(true);
                      }}
                      onEditLesson={handleOpenEditLesson}
                    />
                  ))
                )}

                {/* Modal: Criar Módulo */}
                <Dialog open={showCreateModuleModal} onOpenChange={setShowCreateModuleModal}>
                  <DialogContent className="sm:max-w-[600px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                        Criar módulo
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Configure as informações do novo módulo de aulas
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                      {/* Nome do módulo */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
                          Nome do módulo
                        </Label>
                        <Input
                          type="text"
                          placeholder="Nome do módulo"
                          value={moduleName}
                          onChange={(e) => setModuleName(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Descrição do módulo */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Label className="text-sm font-medium text-gray-900 dark:text-white">
                            Descrição do módulo
                          </Label>
                          <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                          </svg>
                        </div>
                        <Textarea
                          placeholder="Descrição do módulo"
                          value={moduleDescription}
                          onChange={(e) => setModuleDescription(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 min-h-[80px]"
                        />
                      </div>

                      {/* Acesso */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <Label className="text-sm font-medium text-gray-900 dark:text-white">
                            Acesso
                          </Label>
                          <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                            Desmarcar todas
                          </button>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          Turmas com acesso ao módulo
                        </p>
                        <div className="p-4 border border-gray-200 dark:border-lime-500/20 rounded-lg">
                          <div className="flex items-center gap-3">
                            <Checkbox defaultChecked />
                            <span className="text-sm text-gray-900 dark:text-white">
                              Turma A <span className="text-gray-500 dark:text-gray-400">(padrão)</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Liberação */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-3 block">
                          Liberação
                        </Label>
                        <RadioGroup value={moduleReleaseType} onValueChange={setModuleReleaseType} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="liberar" id="module-release-liberar" />
                            <label htmlFor="module-release-liberar" className="flex items-center gap-2 cursor-pointer">
                              <span className="text-sm text-gray-900 dark:text-white">Liberar</span>
                              <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                              </svg>
                            </label>
                          </div>
                          {moduleReleaseType === "liberar" && (
                            <div className="flex items-center gap-2 ml-8">
                              <Input
                                type="number"
                                value={moduleReleaseDays}
                                onChange={(e) => setModuleReleaseDays(e.target.value)}
                                className="w-20 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                                min="0"
                              />
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                dias após a compra
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="agendar" id="module-release-agendar" />
                            <label htmlFor="module-release-agendar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Agendar
                            </label>
                          </div>
                        </RadioGroup>
                      </div>

                      {/* Visibilidade */}
                      <div>
                        <Label className="text-sm font-medium text-gray-900 dark:text-white mb-3 block">
                          Visibilidade
                        </Label>
                        <RadioGroup value={moduleVisibility} onValueChange={setModuleVisibility} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="mostrar" id="module-visibility-mostrar" />
                            <label htmlFor="module-visibility-mostrar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Mostrar
                            </label>
                          </div>
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="ocultar" id="module-visibility-ocultar" />
                            <label htmlFor="module-visibility-ocultar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Ocultar
                            </label>
                          </div>
                        </RadioGroup>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowCreateModuleModal(false);
                          setModuleName("");
                          setModuleDescription("");
                          setModuleReleaseType("liberar");
                          setModuleReleaseDays("0");
                          setModuleVisibility("mostrar");
                        }}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleCreateModule}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        <span className="mr-2">✓</span>
                        Salvar
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Modal: Adicionar Conteúdo/Aula */}
                <Dialog open={showAddLessonModal} onOpenChange={setShowAddLessonModal}>
                  <DialogContent className="sm:max-w-[700px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                        Adicionar conteúdo
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Adicione uma nova aula ou conteúdo ao módulo
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                      {/* Conteúdo Nº */}
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Conteúdo</span>
                        <span className="font-medium">Nº 0</span>
                      </div>

                      {/* Texto - Título */}
                      <div>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-2 block">
                          Texto
                        </Label>
                        <Label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">
                          Título <span className="text-gray-500">(obrigatório)</span>
                        </Label>
                        <Input
                          type="text"
                          placeholder="Insira o título do conteúdo"
                          value={lessonTitle}
                          onChange={(e) => setLessonTitle(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Descrição */}
                      <div>
                        <Label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">
                          Descrição
                        </Label>
                        <Textarea
                          placeholder=""
                          value={lessonDescription}
                          onChange={(e) => setLessonDescription(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 min-h-[100px]"
                          maxLength={3000}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {lessonDescription.length}/3.000 caracteres
                        </p>
                      </div>

                      {/* 📸 CAPA VERTICAL DA AULA - BUNNY.NET CDN UPLOAD */}
                      <div>
                        <ImageUpload
                          value={lessonImageUrl}
                          onChange={setLessonImageUrl}
                          category="lessons"
                          label="Capa da Aula (Vertical 2:3) (opcional)"
                          description="📐 A imagem deve ter exatamente 1410x2250 pixels (proporção 2:3). Apenas PNG, JPG, GIF ou WebP."
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          requiredDimensions={{ width: 1410, height: 2250 }}
                        />
                      </div>

                      {/* Vídeo */}
                      <div>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-3 block">
                          Vídeo
                        </Label>
                        
                        <VideoUpload
                          value={lessonBunnyVideoGuid}
                          onChange={setLessonBunnyVideoGuid}
                          label=""
                          description="MP4, WebM ou MOV (máx. 500MB) - Hospedagem otimizada com entrega rápida"
                        />
                      </div>

                      {/* Liberação */}
                      <div>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-3 block">
                          Liberação
                        </Label>
                        <RadioGroup value={lessonReleaseType} onValueChange={setLessonReleaseType} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="liberar" id="lesson-release-liberar" />
                            <label htmlFor="lesson-release-liberar" className="flex items-center gap-2 cursor-pointer">
                              <span className="text-sm text-gray-900 dark:text-white">Liberar</span>
                              <svg className="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
                              </svg>
                            </label>
                          </div>
                          {lessonReleaseType === "liberar" && (
                            <div className="flex items-center gap-2 ml-8">
                              <Input
                                type="number"
                                value={lessonReleaseDays}
                                onChange={(e) => setLessonReleaseDays(e.target.value)}
                                className="w-20 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                                min="0"
                              />
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                dias após a compra
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="agendar" id="lesson-release-agendar" />
                            <label htmlFor="lesson-release-agendar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Agendar
                            </label>
                          </div>
                        </RadioGroup>
                      </div>

                      {/* Visibilidade */}
                      <div>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-3 block">
                          Visibilidade
                        </Label>
                        <RadioGroup value={lessonVisibility} onValueChange={setLessonVisibility} className="space-y-3">
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="mostrar" id="lesson-visibility-mostrar" />
                            <label htmlFor="lesson-visibility-mostrar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Mostrar
                            </label>
                          </div>
                          <div className="flex items-center gap-3">
                            <RadioGroupItem value="ocultar" id="lesson-visibility-ocultar" />
                            <label htmlFor="lesson-visibility-ocultar" className="text-sm text-gray-900 dark:text-white cursor-pointer">
                              Ocultar
                            </label>
                          </div>
                        </RadioGroup>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowAddLessonModal(false);
                          setLessonTitle("");
                          setLessonDescription("");
                          setLessonVideoType("youtube");
                          setLessonVideoUrl("");
                          setLessonReleaseType("liberar");
                          setLessonReleaseDays("0");
                          setLessonVisibility("mostrar");
                        }}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleAddLesson}
                        className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                      >
                        <span className="mr-2">✓</span>
                        Salvar
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Modal: Editar Conteúdo/Aula */}
                <Dialog open={showEditLessonModal} onOpenChange={setShowEditLessonModal}>
                  <DialogContent className="sm:max-w-[700px] bg-white dark:bg-transparent max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                        Editar conteúdo
                      </DialogTitle>
                      <DialogDescription className="text-gray-600 dark:text-gray-400">
                        Edite as informações do conteúdo
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                      {/* Texto - Título */}
                      <div>
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-2 block">
                          Texto
                        </Label>
                        <Label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">
                          Título <span className="text-gray-500">(obrigatório)</span>
                        </Label>
                        <Input
                          type="text"
                          placeholder="Insira o título do conteúdo"
                          value={lessonTitle}
                          onChange={(e) => setLessonTitle(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
                        />
                      </div>

                      {/* Descrição */}
                      <div>
                        <Label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">
                          Descrição
                        </Label>
                        <Textarea
                          placeholder=""
                          value={lessonDescription}
                          onChange={(e) => setLessonDescription(e.target.value)}
                          className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 min-h-[100px]"
                          maxLength={3000}
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {lessonDescription.length}/3.000 caracteres
                        </p>
                      </div>

                      {/* 📸 CAPA VERTICAL DA AULA - BUNNY.NET CDN UPLOAD */}
                      <div>
                        <ImageUpload
                          value={lessonImageUrl}
                          onChange={setLessonImageUrl}
                          category="lessons"
                          label="Capa da Aula (Vertical 2:3) (opcional)"
                          description="📐 A imagem deve ter exatamente 1410x2250 pixels (proporção 2:3). Apenas PNG, JPG, GIF ou WebP."
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          requiredDimensions={{ width: 1410, height: 2250 }}
                        />
                      </div>

                      {/* Vídeo */}
                      <div>
                        <VideoUpload
                          value={lessonBunnyVideoGuid}
                          onChange={setLessonBunnyVideoGuid}
                          label="Vídeo da Aula (opcional)"
                          description="Faça upload do vídeo para a plataforma de hospedagem"
                        />
                      </div>

                      {/* 🔒 LIBERAÇÃO PROGRESSIVA */}
                      <div className="border-t border-gray-200 dark:border-lime-500/20 pt-6">
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-4 block">
                          🔒 Liberação progressiva
                        </Label>
                        <div className="space-y-4">
                          <RadioGroup 
                            value={lessonReleaseType} 
                            onValueChange={(value) => {
                              setLessonReleaseType(value);
                              if (value === "liberar") {
                                setLessonReleaseDays("0");
                              }
                            }}
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem value="liberar" id="edit-lesson-liberar" />
                              <Label htmlFor="edit-lesson-liberar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                                Liberar imediatamente após a compra
                              </Label>
                            </div>
                            <div className="flex items-start space-x-2">
                              <RadioGroupItem value="programar" id="edit-lesson-programar" className="mt-1" />
                              <div className="flex-1">
                                <Label htmlFor="edit-lesson-programar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer block mb-2">
                                  Liberar X dias após a compra
                                </Label>
                                {lessonReleaseType === "programar" && (
                                  <Input
                                    type="number"
                                    min="0"
                                    placeholder="Número de dias"
                                    value={lessonReleaseDays}
                                    onChange={(e) => setLessonReleaseDays(e.target.value)}
                                    className="bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20 max-w-[200px]"
                                  />
                                )}
                              </div>
                            </div>
                          </RadioGroup>
                        </div>
                      </div>

                      {/* 👁️ VISIBILIDADE */}
                      <div className="border-t border-gray-200 dark:border-lime-500/20 pt-6">
                        <Label className="text-sm font-semibold text-gray-900 dark:text-white mb-4 block">
                          👁️ Visibilidade
                        </Label>
                        <RadioGroup value={lessonVisibility} onValueChange={setLessonVisibility}>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="mostrar" id="edit-lesson-mostrar" />
                            <Label htmlFor="edit-lesson-mostrar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                              Mostrar (visível para alunos)
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="ocultar" id="edit-lesson-ocultar" />
                            <Label htmlFor="edit-lesson-ocultar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                              Ocultar (não aparece na lista de aulas)
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowEditLessonModal(false);
                          setLessonTitle("");
                          setLessonDescription("");
                          setLessonVideoType("bunny");
                          setLessonVideoUrl("");
                          setLessonBunnyVideoGuid("");
                          setLessonImageUrl("");
                          setLessonReleaseType("liberar");
                          setLessonReleaseDays("0");
                          setLessonVisibility("mostrar");
                          setEditingLessonId(null);
                        }}
                        className="border-gray-300 dark:border-gray-600"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleEditLesson}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <span className="mr-2">💾</span>
                        Salvar alterações
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Placeholder para outras seções */}
            {activeSection !== "checkouts" && activeSection !== "configuracoes" && activeSection !== "pixels" && activeSection !== "upsell" && activeSection !== "cupons" && activeSection !== "afiliacao" && activeSection !== "coproducao" && activeSection !== "alunos" && activeSection !== "aulas" && activeSection !== "apagar-produto" && activeSection !== "logistica" && (
              <Card className="bg-white dark:bg-transparent shadow-card">
                <CardContent className="p-12 text-center">
                  <p className="text-gray-500 dark:text-gray-400">
                    Seção "{menuItems.find(m => m.id === activeSection)?.label}" em desenvolvimento
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Editar Checkout */}
      <EditCheckoutModal
        open={isEditCheckoutModalOpen}
        onOpenChange={(open) => {
          setIsEditCheckoutModalOpen(open);
          if (!open) {
            setSelectedOfferId(undefined);
          }
        }}
        productId={productId}
        productName={productName}
        productType={productData?.productType as "digital" | "subscription" | undefined}
        checkoutId={selectedOfferId}
        onSuccess={() => {
          // Invalidar queries para recarregar ofertas e checkouts públicos
          const currentTenantId = auth.currentUser?.uid;
          if (currentTenantId) {
            queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${currentTenantId}`] });
          }
          // Invalidar também queries de checkouts individuais
          queryClient.invalidateQueries({ queryKey: ['/api/checkout'] });
          setSelectedOfferId(undefined);
        }}
      />

      {/* 🚨 ALERTA: Desativar Sistema de Afiliação */}
      <Dialog open={showDisableAffiliateAlert} onOpenChange={setShowDisableAffiliateAlert}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <span className="text-2xl">⚠️</span>
              Desativar Sistema de Afiliação?
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-4">
              <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                Ao desativar o sistema de afiliação, as seguintes ações serão realizadas:
              </p>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">❌</span>
                  <span>O produto será <strong className="text-gray-900 dark:text-white">removido da vitrine</strong> de afiliados</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">🔗</span>
                  <span>Todos os <strong className="text-gray-900 dark:text-white">links de afiliados ficarão indisponíveis</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-500 mt-0.5">🚫</span>
                  <span>O produto ficará como <strong className="text-gray-900 dark:text-white">"afiliação desativada"</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-500 mt-0.5">⏸️</span>
                  <span>Afiliados existentes <strong className="text-gray-900 dark:text-white">não poderão mais promover</strong> este produto</span>
                </li>
              </ul>
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md p-3 mt-4">
                <p className="text-xs font-medium text-orange-900 dark:text-orange-100">
                  💡 <strong>Dica:</strong> Você pode reativar o sistema de afiliação a qualquer momento, mas os afiliados precisarão ser reaprovados.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowDisableAffiliateAlert(false)}
              className="border-gray-300 dark:border-gray-600"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                // Desativar no estado local
                setAffiliatesEnabled(false);
                setShowDisableAffiliateAlert(false);
                
                // Persistir no backend
                try {
                  if (!productId) {
                    toast({
                      title: "Erro",
                      description: "ID do produto não encontrado",
                      variant: "destructive"
                    });
                    return;
                  }

                  const parseSafe = (value: string, defaultValue: number): number => {
                    if (!value || value.trim() === '') return defaultValue;
                    const parsed = Number(value);
                    return isNaN(parsed) ? defaultValue : parsed;
                  };

                  const affiliateConfig = {
                    enabled: false, // DESATIVADO
                    autoApprove,
                    extendCommission,
                    shareData,
                    marketplaceEnabled,
                    commissions: {
                      single: parseSafe(singleCommission, 10),
                      recurring: parseSafe(recurringCommission, 0),
                      type: commissionType,
                    },
                    preference: commissionPreference,
                    cookieDuration: parseSafe(cookieDuration, 30),
                    selectedOffers: selectedOffers,
                    support: {
                      name: supportName,
                      email: supportEmail,
                      phone: supportPhone
                    },
                    salesPage: affiliateSalesPage,
                    rules: affiliateRules
                  };

                  await apiRequest(`/api/products/${productId}/affiliate-config`, 'PATCH', affiliateConfig);

                  toast({
                    title: "Sistema de Afiliação Desativado",
                    description: "O produto foi removido da vitrine e todos os links de afiliados estão indisponíveis.",
                  });
                } catch (error: any) {
                  console.error("Erro ao desativar afiliação:", error);
                  toast({
                    title: "Erro",
                    description: error?.error || "Não foi possível desativar o sistema de afiliação",
                    variant: "destructive"
                  });
                  // Reverter estado em caso de erro
                  setAffiliatesEnabled(true);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <span className="mr-2">⚠️</span>
              Confirmar Desativação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Página de Vendas */}
      <Dialog open={showSalesPageModal} onOpenChange={setShowSalesPageModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Página de vendas</DialogTitle>
            <DialogDescription>
              Configure a URL da sua página de vendas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="salesPageUrl" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                URL da página
              </Label>
              <Input
                id="salesPageUrl"
                type="url"
                placeholder="https://exemplo.com/produto"
                value={salesPage}
                onChange={(e) => setSalesPage(e.target.value)}
                className="mt-2 bg-white dark:bg-gray-700 border-gray-200 dark:border-lime-500/20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSalesPageModal(false)}
              className="border-gray-300 dark:border-gray-600"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setShowSalesPageModal(false);
                toast({
                  title: "Página de vendas atualizada!",
                  description: "A URL foi salva com sucesso.",
                });
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== MODAL CONFIRMAÇÃO: APAGAR PRODUTO ===== */}
      <AlertDialog open={showDeleteProductModal} onOpenChange={setShowDeleteProductModal}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Apagar produto permanentemente?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <p>Esta ação é <strong className="text-red-600">irreversível</strong>. O produto será removido e não poderá mais ser vendido.</p>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 space-y-1.5">
                  <p className="font-medium text-gray-900 dark:text-gray-100">O que será apagado:</p>
                  <p className="text-red-600">✗ Produto, checkouts e links de venda</p>
                  <p className="text-red-600">✗ Vídeos e aulas da área de membros</p>
                  <p className="text-red-600">✗ Fotos e capas do produto no Bunny</p>
                </div>
                <div className="bg-blue-50 dark:bg-green-950/30 border border-blue-200 dark:border-green-800 rounded-lg p-3 space-y-1.5">
                  <p className="font-medium text-gray-900 dark:text-gray-100">O que será mantido:</p>
                  <p className="text-blue-700 dark:text-blue-400">✓ Histórico de vendas e transações</p>
                  <p className="text-blue-700 dark:text-blue-400">✓ Saldos e comissões já gerados</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingProduct}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingProduct}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async (e) => {
                e.preventDefault();
                setIsDeletingProduct(true);
                try {
                  const token = await auth.currentUser?.getIdToken();
                  if (!token) {
                    toast({ variant: "destructive", title: "Erro", description: "Token de autenticação não encontrado" });
                    setIsDeletingProduct(false);
                    return;
                  }
                  const response = await fetch(`/api/products/${id}/direct`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
                  });
                  const data = await response.json();
                  if (response.ok) {
                    toast({ title: "Produto apagado!", description: "O produto foi removido e a mídia será limpa em instantes." });
                    setShowDeleteProductModal(false);
                    await queryClient.invalidateQueries({ queryKey: ["products", tenantId] });
                    await queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
                    setTimeout(() => navigate("/dashboard/products-list"), 500);
                  } else {
                    toast({ variant: "destructive", title: "Erro ao apagar", description: data.error || "Não foi possível apagar o produto." });
                    setIsDeletingProduct(false);
                  }
                } catch (error) {
                  console.error("Erro ao apagar produto:", error);
                  toast({ variant: "destructive", title: "Erro", description: "Erro ao apagar o produto. Tente novamente." });
                  setIsDeletingProduct(false);
                }
              }}
              data-testid="button-confirm-delete-product"
            >
              {isDeletingProduct ? "Apagando..." : "Sim, apagar produto"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== MODAL CONFIRMAÇÃO: APAGAR OFERTA ===== */}
      <AlertDialog open={!!deleteOfferTarget} onOpenChange={(open) => { if (!open) setDeleteOfferTarget(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Apagar oferta?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta oferta será removida permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async (e) => {
                e.preventDefault();
                const offerId = deleteOfferTarget;
                setDeleteOfferTarget(null);
                try {
                  const token = await auth.currentUser?.getIdToken();
                  if (!token) return;
                  const response = await fetch(`/api/products/${id}/offers/${offerId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                  });
                  if (response.ok) {
                    toast({ title: "Oferta apagada!", description: "A oferta foi removida com sucesso." });
                    if (tenantId) queryClient.invalidateQueries({ queryKey: [`/api/checkouts-by-tenant/${tenantId}`] });
                  } else {
                    const data = await response.json();
                    toast({ variant: "destructive", title: "Erro", description: data.error || "Erro ao apagar oferta" });
                  }
                } catch (error) {
                  toast({ variant: "destructive", title: "Erro", description: "Erro ao apagar oferta" });
                }
              }}
              data-testid="button-confirm-delete-offer"
            >
              Apagar oferta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== MODAL CONFIRMAÇÃO: APAGAR CUPOM ===== */}
      <AlertDialog open={!!deleteCouponTarget} onOpenChange={(open) => { if (!open) setDeleteCouponTarget(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Apagar cupom?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Este cupom será removido permanentemente e não poderá mais ser utilizado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async (e) => {
                e.preventDefault();
                const couponId = deleteCouponTarget;
                setDeleteCouponTarget(null);
                try {
                  const token = await auth.currentUser?.getIdToken();
                  if (!token) return;
                  const response = await fetch(`/api/products/${id}/coupons/${couponId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                  });
                  if (response.ok) {
                    toast({ title: "Cupom apagado!", description: "O cupom foi removido com sucesso." });
                    refetchCoupons();
                  } else {
                    const data = await response.json();
                    toast({ variant: "destructive", title: "Erro", description: data.error || "Erro ao apagar cupom" });
                  }
                } catch (error) {
                  toast({ variant: "destructive", title: "Erro", description: "Erro ao apagar cupom" });
                }
              }}
              data-testid="button-confirm-delete-coupon"
            >
              Apagar cupom
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </DashboardLayout>
  );
}
