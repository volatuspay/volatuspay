import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Removido import do updateLesson - agora usando API endpoint
import { apiRequest } from "@/lib/queryClient";
import { insertLessonSchema, type Lesson, type Module } from "@shared/schema";
import { ImageUpload } from "@/components/ui/image-upload";
import { useToast } from "@/hooks/use-toast";

const formSchema = insertLessonSchema;

type FormData = z.infer<typeof formSchema>;

interface LessonFormProps {
  modules: Module[];
  lesson?: Lesson;
  onSuccess?: () => void;
}

export function LessonForm({ modules, lesson, onSuccess }: LessonFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Pegar productId e moduleId do primeiro mdulo
  const productId = modules.length > 0 ? modules[0].productId : "";
  const defaultModuleId = modules.length > 0 ? modules[0].id : "";
  
  console.log(" FORM - Mdulos recebidos:", modules.length);
  console.log(" FORM - ModuleId padrão:", defaultModuleId);
  console.log(" FORM - ProductId padrão:", productId);
  
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      productId: lesson?.productId || productId,
      moduleId: lesson?.moduleId || defaultModuleId, //  USAR moduleId DO MDULO SELECIONADO
      title: lesson?.title || "",
      description: lesson?.description || "",
      imageUrl: lesson?.imageUrl || "",
      videoType: lesson?.videoType || "youtube",
      videoUrl: lesson?.videoUrl || "",
      active: lesson?.active ?? true,
      attachmentUrl: lesson?.attachmentUrl || "",
      externalUrl: lesson?.externalUrl || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      console.log(" MUTATION INICIADA!");
      if (lesson) {
        //  USAR API SERVIDOR PARA UPDATE (SEGURANÇA + VALIDAÇÃO ZOD)
        console.log(" Atualizando aula via API backend:", data);
        const response = await apiRequest(`/api/lessons/${lesson.id}`, "PUT", data);
        console.log(" Response recebida:", response.status);
        //  SAFE JSON PARSING - previne travamento em resposta vazia
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      //  USAR API SERVIDOR PARA CREATE (CORRIGE PERMISSION-DENIED)
      console.log(" Criando aula via API backend:", data);
      const response = await apiRequest("/api/lessons", "POST", data);
      console.log(" Response recebida:", response.status);
      //  SAFE JSON PARSING - previne travamento em resposta vazia
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
    onSuccess: async (result) => {
      const moduleId = form.getValues("moduleId");
      console.log(" Invalidando cache de aulas para mdulo:", moduleId);
      
      //  CORREÇÃO: Apenas uma invalidao precisa para evitar loops
      if (result && !lesson) {
        queryClient.setQueryData(["lessons", moduleId], (prev: any = []) => [result, ...prev]);
      }
      await queryClient.invalidateQueries({ queryKey: ["lessons", moduleId], exact: true });
      
      //  INVALIDAR CACHE DE REA DE MEMBROS (para aparecerá aula criada)
      await queryClient.invalidateQueries({ queryKey: ["members-modules", productId] });
      
      //  INVALIDAR CACHE DE TODOS OS LESSONS DO VENDEDOR (dashboard)
      await queryClient.invalidateQueries({ queryKey: ["lessons"] });
      
      console.log(" Cache atualizado eficientemente - área deb membros + dashboard!");
      
      // TOAST DE SUCESSO
      toast({
        title: lesson ? "Aula atualizada!" : "Aula criada!",
        description: lesson 
          ? "As alterações foram salvas com sucesso." 
          : "A aula foi criada e aparecerá na área deb membros.",
        variant: "default",
      });
      
      onSuccess?.();
    },
    onError: (error) => {
      console.error(" ERRO NA MUTATION:", error);
      
      // TOAST DE ERRO
      toast({
        title: "Erro ao salvar aula",
        description: "Ocorreu um erro ao salvar a aula. Tente novamente.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      console.log(" Mutation finalizada - botão sempre liberado!");
    },
  });

  const onSubmit = (data: FormData) => {
    console.log(" SUBMIT ACIONADO - Dados:", data);
    console.log("Erros do form:", form.formState.errors);
    mutation.mutate(data);
  };

  const videoTypeOptions = [
    { value: "youtube", label: "YouTube" },
    { value: "vimeo", label: "Vimeo" },
    { value: "panda", label: "Panda Video" },
    { value: "custom", label: "Personalizado" },
  ];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-6">
        {/* Layout em grid para popup horizontal - responsivo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Coluna 1 - Dados bsicos */}
          <div className="space-y-3 sm:space-y-4">
            <FormField
              control={form.control}
              name="moduleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Mdulo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-lesson-module" className="h-12 sm:h-11 text-base">
                        <SelectValue placeholder="Selecione um mdulo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {modules.map((module) => (
                        <SelectItem key={module.id} value={module.id}>
                          {module.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Ttulo da Aula</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex: Como criar campanhas efetivas"
                      className="text-base h-12 sm:h-11"
                      data-testid="input-lesson-title"
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
                      placeholder="Descreva o conteúdo desta aula..."
                      className="min-h-24 text-base resize-none"
                      data-testid="textarea-lesson-description"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Coluna 2 - Configurações do vídeo */}
          <div className="space-y-3 sm:space-y-4">
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ImageUpload
                      value={field.value}
                      onChange={field.onChange}
                      category="lessons"
                      label="Capa da Aula (Vertical 2:3) (opcional)"
                      description="📐 Recomendado: imagem vertical (proporção 2:3) para exibição estilo Netflix na área de membros"
                      requiredAspectRatio={{ ratio: 2/3, tolerance: 0.02 }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="videoType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Tipo de Vdeo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-lesson-video-type" className="h-12 sm:h-11 text-base">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {videoTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="videoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">URL do Vdeo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="text-base h-12 sm:h-11"
                      data-testid="input-lesson-video-url"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="attachmentUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Anexo PDF (Opcional)</FormLabel>
                  <FormControl>
                    <ImageUpload
                      value={field.value || ""}
                      onChange={field.onChange}
                      data-testid="upload-lesson-attachment"
                    />
                  </FormControl>
                  <FormDescription className="text-sm text-muted-foreground">
                    Adicione um PDF para download (mx. 10MB)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="externalUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Link Externo (Opcional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://exemplo.com/recurso"
                      className="text-base h-12 sm:h-11"
                      data-testid="input-lesson-external-url"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-sm text-muted-foreground">
                    Link para abrir em nova aba
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Configurações adicionais */}
        <div className="pt-3 sm:pt-4 border-t border-gray-200">
          <FormField
            control={form.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border p-3 space-y-2 sm:space-y-0">
                <div className="space-y-0.5 flex-1">
                  <FormLabel className="text-base font-medium">Aula Ativa</FormLabel>
                  <FormDescription className="text-sm text-muted-foreground">
                    Define se a aula estvisvel para os membros
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-lesson-active"
                    className="data-[state=checked]:bg-primary"
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {/* Botão de submit */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pt-3 sm:pt-4">
          <Button
            type="submit"
            disabled={mutation.isPending || (modules.length === 0 && !lesson)}
            data-testid="button-save-lesson"
            className="w-full sm:w-auto min-w-[120px] h-12 sm:h-11 text-base font-medium"
            size="lg"
            onClick={() => {
              console.log("BOTÃO CLICADO!");
              console.log(" Valores do form:", form.getValues());
              console.log(" Erros de validao:", form.formState.errors);
              console.log(" Form é vlido?", form.formState.isValid);
              console.log(" Botão disabled?", mutation.isPending || modules.length === 0);
            }}
          >
            {mutation.isPending ? "Salvando..." : (lesson ? "Atualizar Aula" : (modules.length === 0 ? "Carregue um mdulo primeiro" : "Criar Aula"))}
          </Button>
        </div>
      </form>
    </Form>
  );
}