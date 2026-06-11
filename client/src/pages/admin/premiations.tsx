import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trophy, Edit, Trash2, Plus, Upload, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatBRL } from "@/lib/utils";
import { auth } from "@/lib/firebase";

interface Achievement {
  id: string;
  milestoneValue: number;
  title: string;
  description: string;
  imageUrl: string;
  createdAt: any;
  updatedAt?: any;
}

const MILESTONES = [
  { value: 10000, label: "R$ 10 mil" },
  { value: 100000, label: "R$ 100 mil" },
  { value: 500000, label: "R$ 500 mil" },
  { value: 1000000, label: "R$ 1 milho" },
];

export default function AchievementsAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState<Achievement | null>(null);
  const [uploading, setUploading] = useState(false);
  
  const [formData, setFormData] = useState({
    milestoneValue: "",
    title: "",
    description: "",
    imageUrl: "",
  });

  // BUSCAR PREMIAÇES EXISTENTES
  const { data: achievements = [], isLoading } = useQuery<Achievement[]>({
    queryKey: ["achievements"],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/admin/achievements", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Erro ao buscar premiações");
      return response.json();
    },
  });

  // SALVAR/ATUALIZAR PREMIAÇÃO
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const token = await auth.currentUser?.getIdToken();
      const url = editingAchievement
        ? `/api/admin/achievements/${editingAchievement.id}`
        : "/api/admin/achievements";
      
      const response = await fetch(url, {
        method: editingAchievement ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erro ao salvar premiação");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Premiação salva!",
        description: "As alterações foram aplicadas com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["achievements"] });
      handleCloseModal();
    },
    onError: (error: any) => {
      toast({
        title: " Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // DELETAR PREMIAÇÃO
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/admin/achievements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Erro ao deletar premiação");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Premiação removida!",
        description: "A premiação foi deletada com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["achievements"] });
    },
    onError: (error: any) => {
      toast({
        title: " Erro ao deletar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // UPLOAD DE IMAGEM
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar tipo de arquivo
    if (!file.type.startsWith("image/")) {
      toast({
        title: " Arquivo inválido",
        description: "Por favor, selecione uma imagem.",
        variant: "destructive",
      });
      return;
    }

    // Validar tamanho (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: " Arquivo muito grande",
        description: "A imagem deve ter no máximo 5MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);

      const response = await fetch("/api/upload/achievement", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: uploadFormData,
      });

      if (!response.ok) throw new Error("Erro no upload");

      const { url } = await response.json();
      setFormData(prev => ({ ...prev, imageUrl: url }));
      
      toast({
        title: " Imagem enviada!",
        description: "A imagem foi carregada com sucesso.",
      });
    } catch (error: any) {
      toast({
        title: " Erro no upload",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleOpenModal = (achievement?: Achievement) => {
    if (achievement) {
      setEditingAchievement(achievement);
      setFormData({
        milestoneValue: achievement.milestoneValue.toString(),
        title: achievement.title,
        description: achievement.description,
        imageUrl: achievement.imageUrl,
      });
    } else {
      setEditingAchievement(null);
      setFormData({
        milestoneValue: "",
        title: "",
        description: "",
        imageUrl: "",
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAchievement(null);
    setFormData({
      milestoneValue: "",
      title: "",
      description: "",
      imageUrl: "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.milestoneValue || !formData.title || !formData.imageUrl) {
      toast({
        title: " Campos obrigatórios",
        description: "Preencha todos os campos obrigatórios.",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate({
      milestoneValue: parseInt(formData.milestoneValue),
      title: formData.title,
      description: formData.description,
      imageUrl: formData.imageUrl,
    });
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Premiações de Saque
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure as imagens e descrições das premiaçãos de saque
          </p>
        </div>
        <Button onClick={() => handleOpenModal()} data-testid="button-add-achievement">
          <Plus className="w-4 h-4 mr-2" />
          Nova Premiação
        </Button>
      </div>

      {/* TABELA DE PREMIAÇÕES */}
      <Card>
        <CardHeader>
          <CardTitle>Premiações Cadastradas</CardTitle>
          <CardDescription>
            Gerencie as imagens e textos que aparecem no sidebar dos sellers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
            </div>
          ) : achievements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Nenhuma premiação cadastrada ainda.</p>
              <p className="text-sm mt-2">Clique em "Nova Premiação" para começar.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Imagem</TableHead>
                  <TableHead>Meta</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {achievements.map((achievement) => (
                  <TableRow key={achievement.id}>
                    <TableCell>
                      <div className="w-20 h-12 rounded overflow-hidden bg-muted">
                        <img
                          src={achievement.imageUrl}
                          alt={achievement.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatBRL(achievement.milestoneValue * 100)}
                    </TableCell>
                    <TableCell>{achievement.title}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {achievement.description || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenModal(achievement)}
                          data-testid={`button-edit-${achievement.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Deseja realmente deletar esta premiação?")) {
                              deleteMutation.mutate(achievement.id);
                            }
                          }}
                          data-testid={`button-delete-${achievement.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* MODAL DE EDIÇÃO */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAchievement ? "Editar Premiação" : "Nova Premiação"}
            </DialogTitle>
            <DialogDescription>
              Configure os detalhes da premiação para motivar os sellers
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* META */}
            <div className="space-y-2">
              <Label htmlFor="milestone">Meta de Saque *</Label>
              <Select
                value={formData.milestoneValue}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, milestoneValue: value }))
                }
              >
                <SelectTrigger data-testid="select-milestone">
                  <SelectValue placeholder="Selecione a meta" />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONES.map((m) => (
                    <SelectItem key={m.value} value={m.value.toString()}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* TÍTULO */}
            <div className="space-y-2">
              <Label htmlFor="title">Título *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Ex: Parabéns por R$ 10 mil em saques!"
                data-testid="input-title"
              />
            </div>

            {/* DESCRIÇÃO */}
            <div className="space-y-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Mensagem motivacional para o seller"
                rows={3}
                data-testid="textarea-description"
              />
            </div>

            {/* IMAGEM */}
            <div className="space-y-2">
              <Label>Imagem da Premiação *</Label>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={uploading}
                    data-testid="input-image"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Formatos aceitos: JPG, PNG, GIF (máx. 5MB)
                  </p>
                </div>
                {formData.imageUrl && (
                  <div className="w-24 h-16 rounded overflow-hidden bg-muted border">
                    <img
                      src={formData.imageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* BOTÕES */}
            <div className="flex items-center justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseModal}
                data-testid="button-cancel"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending || uploading}
                data-testid="button-save"
              >
                {saveMutation.isPending ? "Salvando..." : "Salvar Premiação"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
