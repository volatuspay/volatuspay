import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createProduct, updateProduct, getCheckoutsByTenant } from "@/lib/firestore";
import { insertProductSchema, type Product, type Checkout } from "@shared/schema";
import { useTenantStore } from "@/stores/tenant";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import ProductImageUpload from "@/components/products/product-image-upload";

const formSchema = insertProductSchema.extend({
  imageUrl: z.string().min(1, "Imagem de capa é obrigatória"),
  salesPageUrl: z.string().min(1, "URL da página de vendas é obrigatória").url("URL inválida - deve começar com https://"),
});

type FormData = z.infer<typeof formSchema>;

interface ProductFormProps {
  product?: Product;
  onSuccess?: () => void;
}

export function ProductForm({ product, onSuccess }: ProductFormProps) {
  const { tenant } = useTenantStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  //  MONITORAR USURIO AUTENTICADO
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);
  
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tenantId: tenant?.id || "",
      title: product?.title || "",
      description: product?.description || "",
      imageUrl: product?.imageUrl || "",
      productType: product?.productType || "digital",
      checkoutId: product?.checkoutId || "",
      sellerDisplayName: product?.sellerDisplayName || "",
      salesPageUrl: product?.salesPageUrl || "",
      hasAccess: product?.hasAccess ?? true,
      accessDuration: product?.accessDuration || undefined,
      notifyExpirationDays: product?.notifyExpirationDays || [7, 2, 1],
      active: product?.active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (product) {
        await updateProduct(product.id, data);
        return null;
      } else {
        const effectiveTenantId = tenant?.id || (currentUser ? `tenant_${currentUser.uid}_${Date.now()}` : "");
        return await createProduct({
          ...data,
          tenantId: effectiveTenantId,
        });
      }
    },
    onSuccess: async (result) => {
      if (tenant?.id) {
        if (result && !product) {
          queryClient.setQueryData(["products", tenant.id], (prev: any = []) => [result, ...prev]);
        }
        await queryClient.invalidateQueries({ queryKey: ["products", tenant.id], exact: true });
      }
      
      toast({
        title: product ? "Produto atualizado" : "Produto criado",
        description: product ? "Produto atualizado com sucesso!" : "Produto criado com sucesso!",
      });
      
      onSuccess?.();
    },
    onError: (error) => {
      toast({
        title: "Erro",
        description: "Erro ao salvar produto. Verifique os dados e tente novamente.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    const cleanData = {
      ...data,
      imageUrl: data.imageUrl?.trim() || "",
      notifyExpirationDays: data.notifyExpirationDays || [7, 2, 1],
    };
    
    mutation.mutate(cleanData);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-4 md:px-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6 md:space-y-8">
          
          {/* INFORMAÇES BSICAS */}
          <Card className="shadow-sm">
            <CardHeader className="px-3 sm:px-6 py-4 sm:py-6">
              <CardTitle className="text-lg sm:text-xl">Informações Básicas</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                Configure as informações principais do seu produto
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 space-y-4 sm:space-y-6">
              
              {/* Ttulo */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium">Ttulo do Produto *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Nome do seu produto" 
                        className="text-base h-12 sm:h-11" 
                        {...field} 
                        data-testid="input-title"
                        maxLength={200}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Descrição */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium">Descrição</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Descreva seu produto..." 
                        {...field} 
                        data-testid="textarea-description"
                        className="min-h-24 text-base resize-none"
                        maxLength={200}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Nome para Exibio na Vitrine */}
              <FormField
                control={form.control}
                name="sellerDisplayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium">Nome do Vendedor (Vitrine Pública)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Nome que aparece no card do produto na vitrine (opcional)" 
                        className="text-base h-12 sm:h-11" 
                        {...field} 
                        data-testid="input-seller-display-name"
                        maxLength={100}
                      />
                    </FormControl>
                    <FormDescription className="text-sm text-gray-600 dark:text-gray-400">
                      Se não preencher, será usado o nome da sua empresa. Este nome aparecerá para afiliados e clientes na vitrine pública.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* URL da Página de Vendas */}
              <FormField
                control={form.control}
                name="salesPageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-medium">URL da Página de Vendas *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://seusite.com/produto" 
                        className="text-base h-12 sm:h-11" 
                        {...field} 
                        data-testid="input-sales-page-url"
                        type="url"
                        required
                      />
                    </FormControl>
                    <FormDescription className="text-sm text-gray-600 dark:text-gray-400">
                      ⚠️ <strong>Obrigatório para afiliação:</strong> Esta é a URL oficial onde os afiliados direcionarão o tráfego. As comissões serão contabilizadas através dos links gerados a partir desta página de vendas com o parâmetro ?aff=código_afiliado.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Imagem do Produto */}
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Imagem de Capa do Produto *</FormLabel>
                    <FormControl>
                      <ProductImageUpload
                        value={field.value}
                        onUpload={field.onChange}
                        productData={{
                          title: form.watch('title'),
                          tenantId: tenant?.id
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* BOTES */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 px-2 sm:px-0">
            <Button 
              type="submit" 
              disabled={mutation.isPending}
              data-testid="button-save-product"
              className="w-full sm:w-auto min-w-32 h-12 sm:h-11 text-base font-medium"
              size="lg"
            >
              {mutation.isPending ? "Salvando..." : (product ? "Atualizar Produto" : "Criar Produto")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}