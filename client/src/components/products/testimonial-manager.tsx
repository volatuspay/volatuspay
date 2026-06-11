import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Star, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ImageUpload } from "@/components/ui/image-upload";

interface TestimonialManagerProps {
  checkoutId: string;
}

interface Testimonial {
  id: string;
  checkoutId: string;
  tenantId: string;
  authorName: string;
  authorPhoto?: string;
  rating: number;
  title: string;
  content: string;
  position: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function TestimonialManager({ checkoutId }: TestimonialManagerProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTestimonial, setEditingTestimonial] = useState<Testimonial | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    authorName: '',
    authorPhoto: '',
    rating: 5,
    title: '',
    content: '',
    position: 0,
    active: true,
  });

  const { data: testimonials = [], isLoading } = useQuery<Testimonial[]>({
    queryKey: ['testimonials', checkoutId],
    queryFn: async () => {
      const response = await fetch(`/api/checkouts/${checkoutId}/testimonials`);
      const result = await response.json();
      return result.testimonials || [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/checkouts/${checkoutId}/testimonials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Erro ao criar depoimento');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials', checkoutId] });
      toast({ title: 'Depoimento criado com sucesso!' });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: 'Erro ao criar depoimento',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Testimonial> }) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/checkouts/${checkoutId}/testimonials/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Erro ao atualizar depoimento');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials', checkoutId] });
      toast({ title: 'Depoimento atualizado!' });
      setEditingTestimonial(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/checkouts/${checkoutId}/testimonials/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Erro ao deletar depoimento');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials', checkoutId] });
      toast({ title: 'Depoimento deletado!' });
    },
  });

  const resetForm = () => {
    setFormData({
      authorName: '',
      authorPhoto: '',
      rating: 5,
      title: '',
      content: '',
      position: testimonials.length,
      active: true,
    });
    setEditingTestimonial(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateOpen(true);
  };

  const handleEdit = (testimonial: Testimonial) => {
    setFormData({
      authorName: testimonial.authorName,
      authorPhoto: testimonial.authorPhoto || '',
      rating: testimonial.rating,
      title: testimonial.title,
      content: testimonial.content,
      position: testimonial.position,
      active: testimonial.active,
    });
    setEditingTestimonial(testimonial);
    setIsCreateOpen(true);
  };

  const handleSubmit = () => {
    if (editingTestimonial) {
      updateMutation.mutate({ id: editingTestimonial.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = (testimonial: Testimonial) => {
    updateMutation.mutate({
      id: testimonial.id,
      data: { active: !testimonial.active },
    });
  };

  const renderStars = (rating: number, interactive: boolean = false) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-5 w-5 ${
              star <= rating
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-300'
            } ${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
            onClick={interactive ? () => setFormData({ ...formData, rating: star }) : undefined}
          />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return <div className="text-center py-8">Carregando depoimentos...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Depoimentos</h3>
          <p className="text-sm text-muted-foreground">
            Adicione depoimentos para gerar confiana no seu checkout
          </p>
        </div>
        <Button type="button" onClick={handleOpenCreate} data-testid="button-create-testimonial">
          <Plus className="mr-2 h-4 w-4" />
          Criar Depoimento
        </Button>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingTestimonial ? 'Editar Depoimento' : 'Criar Novo Depoimento'}
              </DialogTitle>
              <DialogDescription>
                Adicione um depoimento de cliente para mostrar no checkout
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Nome do Autor *</Label>
                <Input
                  placeholder="Ex: Joo Silva"
                  value={formData.authorName}
                  onChange={(e) => setFormData({ ...formData, authorName: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <ImageUpload
                  value={formData.authorPhoto}
                  onChange={(url) => setFormData({ ...formData, authorPhoto: url })}
                  category="testimonials"
                  label="Foto do Autor"
                  description="PNG, JPG ou WebP (máx. 5MB) - Recomendado: 200x200px"
                />
              </div>

              <div className="space-y-2">
                <Label>Avaliao *</Label>
                {renderStars(formData.rating, true)}
                <p className="text-xs text-muted-foreground">
                  Clique nas estrelas para escolher a avaliao
                </p>
              </div>

              <div className="space-y-2">
                <Label>Ttulo *</Label>
                <Input
                  placeholder="Ex: Produto excelente!"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Depoimento *</Label>
                <Textarea
                  placeholder="Ex: Comprei este produto e superou todas as minhas expectativas. Recomendo muito!"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={4}
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#f0f4ff]/20/50 border border-slate-200 dark:border-slate-700 rounded-lg">
                <Label>Depoimento Ativo</Label>
                <Switch
                  checked={formData.active}
                  onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                />
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    !formData.authorName ||
                    !formData.title ||
                    !formData.content ||
                    createMutation.isPending ||
                    updateMutation.isPending
                  }
                >
                  {editingTestimonial ? 'Salvar Alterações' : 'Criar Depoimento'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {testimonials.length === 0 ? (
        <EmptyState
          icon={User}
          title="Nenhum depoimento criado"
          description="Adicione depoimentos para aumentar a confiana dos seus clientes"
          action={
            <Button type="button" onClick={handleOpenCreate} data-testid="button-create-first-testimonial">
              <Plus className="mr-2 h-4 w-4" />
              Criar Primeiro Depoimento
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {testimonials.map((testimonial) => (
            <Card key={testimonial.id} className={`bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700 shadow-sm ${!testimonial.active ? 'opacity-60' : ''}`}>
              <CardContent className="p-6">
                <div className="flex gap-4">
                  {testimonial.authorPhoto ? (
                    <img
                      src={testimonial.authorPhoto}
                      alt={testimonial.authorName}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-8 w-8 text-primary" />
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold">{testimonial.authorName}</h4>
                        {renderStars(testimonial.rating)}
                      </div>
                      <div className="flex items-center gap-2">
                        {testimonial.active ? (
                          <Badge variant="default">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary">Inativo</Badge>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(testimonial)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar excluso?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação não pode ser desfeita. O depoimento será removido permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(testimonial.id)}>
                                Deletar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Switch
                          checked={testimonial.active}
                          onCheckedChange={() => handleToggleActive(testimonial)}
                        />
                      </div>
                    </div>
                    <h5 className="font-medium mb-1">{testimonial.title}</h5>
                    <p className="text-sm text-muted-foreground">{testimonial.content}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
