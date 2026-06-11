import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
// Removido import do updateModule - agora usando API endpoint
import { apiRequest } from "@/lib/queryClient";
import { insertModuleSchema, type Module } from "@shared/schema";
import { ImageUpload } from "@/components/ui/image-upload";
import { useToast } from "@/hooks/use-toast";

const formSchema = insertModuleSchema;

type FormData = z.infer<typeof formSchema>;

interface ModuleFormProps {
  productId: string;
  module?: Module;
  onSuccess?: () => void;
}

export function ModuleForm({ productId, module, onSuccess }: ModuleFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      productId,
      title: module?.title || "",
      description: module?.description || "",
      imageUrl: module?.imageUrl || "",
      active: module?.active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      console.log(" MUTATION MDULO INICIADA!");
      if (module) {
        //  USAR API SERVIDOR PARA UPDATE (SEGURANÇA + VALIDAÇÃO ZOD)
        console.log(" Atualizando mdulo via API backend:", data);
        const response = await apiRequest(`/api/modules/${module.id}`, "PUT", data);
        console.log(" Response recebida:", response.status);
        //  SAFE JSON PARSING - previne travamento em resposta vazia
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      //  USAR API SERVIDOR PARA CREATE (CORRIGE PERMISSION-DENIED)
      console.log(" Criando mdulo via API backend:", data);
      const response = await apiRequest("/api/modules", "POST", data);
      console.log(" Response recebida:", response.status);
      //  SAFE JSON PARSING - previne travamento em resposta vazia
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
    onSuccess: async (result) => {
      console.log(" Invalidando cache de mdulos para produto:", productId);
      
      //  CORREÇÃO: Apenas uma invalidao precisa para evitar loops
      if (result && !module) {
        queryClient.setQueryData(["modules", productId], (prev: any = []) => [result, ...prev]);
      }
      await queryClient.invalidateQueries({ queryKey: ["modules", productId], exact: true });
      
      console.log(" Cache atualizado eficientemente!");
      
      // TOAST DE SUCESSO
      toast({
        title: module ? "Mdulo atualizado!" : "Mdulo criado!",
        description: module 
          ? "As alterações foram salvas com sucesso." 
          : "O mdulo foi criado e aparecerá na área deb membros.",
        variant: "default",
      });
      
      onSuccess?.();
    },
    onError: (error) => {
      console.error(" ERRO NA MUTATION MDULO:", error);
      
      // TOAST DE ERRO
      toast({
        title: "Erro ao salvar mdulo",
        description: "Ocorreu um erro ao salvar o mdulo. Tente novamente.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      console.log(" Mutation finalizada - botão sempre liberado!");
    },
  });

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-medium">Ttulo do Mdulo</FormLabel>
              <FormControl>
                <Input
                  placeholder="Ex: Introdução ao Marketing"
                  className="text-base h-12 sm:h-11"
                  data-testid="input-module-title"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-medium">Descrição</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Descreva o que serabordado neste mdulo..."
                  className="min-h-24 text-base resize-none"
                  data-testid="textarea-module-description"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="imageUrl"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <ImageUpload
                  value={field.value}
                  onChange={field.onChange}
                  category="modules"
                  label="Capa do Módulo (Vertical 2:3)"
                  description="📐 Recomendado: imagem vertical (proporção 2:3) para exibição estilo Netflix"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* INFO: Numerao automática */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-blue-600 dark:text-blue-400 text-xl"></div>
            <div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">Numerao Automática</h4>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Os mdulos so numerados automaticamente em sequncia (1, 2, 3...). 
                Na área deb membros, eles aparecem na ordem correta automaticamente.
              </p>
            </div>
          </div>
        </div>

        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem className="flex flex-col sm:flex-row sm:items-center justify-between space-y-2 sm:space-y-0 p-3 sm:p-4 border rounded-lg">
              <div className="flex-1">
                <FormLabel className="text-base font-medium">Mdulo Ativo</FormLabel>
                <FormDescription className="text-sm text-muted-foreground">
                  Define se o mdulo estvisvel para os membros
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="switch-module-active"
                  className="data-[state=checked]:bg-primary"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <Button
            type="submit"
            disabled={mutation.isPending}
            data-testid="button-save-module"
            className="w-full sm:w-auto h-12 sm:h-11 text-base font-medium"
            size="lg"
            onClick={() => {
              console.log("BOTÃO MDULO CLICADO!");
              console.log(" Valores do form mdulo:", form.getValues());
              console.log(" Erros de validao mdulo:", form.formState.errors);
              console.log(" Form mdulo é vlido?", form.formState.isValid);
              console.log(" Botão mdulo disabled?", mutation.isPending);
            }}
          >
            {mutation.isPending ? "Salvando..." : (module ? "Atualizar Mdulo" : "Criar Mdulo")}
          </Button>
        </div>
      </form>
    </Form>
  );
}