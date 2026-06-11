import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { resolveImageUrl } from "@/lib/image-url";
import { Image, Plus, Edit, Trash2, Eye, ExternalLink, Search, CheckCircle, XCircle } from "lucide-react";
import type { Banner, InsertBanner } from "@shared/schema";
import { auth } from "@/lib/firebase";

// FUNÇÃO AUXILIAR: OBTER TOKEN DE AUTENTICAÇÃO
async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    
    const token = await user.getIdToken();
    console.log('Token obtido para admin banners:', user.uid);
    return token;
  } catch (error) {
    console.error('Erro ao obter token:', error);
    return null;
  }
}

// FUNÇÃO AUXILIAR: CRIAR HEADERS COM AUTENTICAÇÃO
async function getAuthHeaders(additionalHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers = { ...additionalHeaders };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    console.log('Authorization header adicionado requisio admin');
  }
  
  return headers;
}

export default function AdminBanners() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<Banner | null>(null);
  const [formData, setFormData] = useState<Partial<InsertBanner>>({
    imageUrl: "",
    link: "",
    isActive: true,
    position: "dashboard_top",
    priority: 0,
    targetBlank: true,
  });

  // Carregar banners (admin jverificado pelo AdminRoute)
  useEffect(() => {
    if (!user) {
      console.log('Aguardando autenticação...');
      return;
    }

    loadBanners();
  }, [user]);

  const loadBanners = async () => {
    try {
      setLoading(true);
      console.log('Desconto: Admin carregando todos os banners...');

      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/banners', {
        headers,
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Erro ao carregar banners');
      }
      
      const bannersData = await response.json();
      setBanners(bannersData);
      console.log(`${bannersData.length} banners carregados`);
    } catch (error) {
      console.error('Erro ao carregar banners:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar banners. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBanner = async () => {
    if (isSaving) return; // Evitar mltiplos cliques
    
    try {
      setIsSaving(true);
      
      if (!formData.imageUrl) {
        toast({
          title: "Erro",
          description: "URL da imagem é obrigatria.",
          variant: "destructive",
        });
        setIsSaving(false);
        return;
      }

      // Dados do banner sem ttulo
      const bannerData = formData;

      const url = isEditing && selectedBanner ? `/api/admin/banners/${selectedBanner.id}` : '/api/admin/banners';
      const method = isEditing ? 'PUT' : 'POST';

      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(bannerData),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao salvar banner');
      }

      toast({
        title: "Sucesso",
        description: `Banner ${isEditing ? 'atualizado' : 'criado'} com sucesso!`,
      });

      setIsCreating(false);
      setIsEditing(false);
      setSelectedBanner(null);
      resetForm();
      loadBanners();
    } catch (error) {
      console.error('Erro ao salvar banner:', error);
      toast({
        title: "Erro",
        description: `Erro ao ${isEditing ? 'atualizar' : 'criar'} banner. Tente novamente.`,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBanner = async (banner: Banner) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/banners/${banner.id}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao deletar banner');
      }

      toast({
        title: "Sucesso",
        description: "Banner deletado com sucesso!",
      });

      loadBanners();
    } catch (error) {
      console.error('Erro ao deletar banner:', error);
      toast({
        title: "Erro",
        description: "Erro ao deletar banner. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const toggleBannerStatus = async (banner: Banner) => {
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/json',
      });

      const response = await fetch(`/api/admin/banners/${banner.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ isActive: !banner.isActive }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao alterar status do banner');
      }

      toast({
        title: "Sucesso",
        description: `Banner ${banner.isActive ? 'desativado' : 'ativado'} com sucesso!`,
      });

      loadBanners();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      toast({
        title: "Erro",
        description: "Erro ao alterar status do banner. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      imageUrl: "",
      link: "",
      isActive: true,
      position: "dashboard_top",
      priority: 0,
      description: "",
      targetBlank: true,
    });
  };

  const openEditDialog = (banner: Banner) => {
    setSelectedBanner(banner);
    setFormData({
      imageUrl: banner.imageUrl,
      link: banner.link,
      isActive: banner.isActive,
      position: banner.position,
      priority: banner.priority,
      description: banner.description || "",
      targetBlank: banner.targetBlank,
    });
    setIsEditing(true);
  };

  const filteredBanners = banners.filter(banner =>
    banner.imageUrl.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (banner.link && banner.link.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStatusBadge = (banner: Banner) => {
    if (banner.isActive) {
      return <Badge className="bg-emerald-100 text-muted-foreground"><CheckCircle className="w-3 h-3 mr-1" />Ativo</Badge>;
    } else {
      return <Badge variant="secondary"><XCircle className="w-3 h-3 mr-1" />Inativo</Badge>;
    }
  };

  // TRADUZIR POSIÇES DE BANNER PARA NOMES AMIGVEIS
  const getPositionName = (position: string) => {
    const positions: Record<string, string> = {
      'dashboard_top': 'Dashboard (Topo)',
      'showcase': 'Vitrine Pública (Topo)',
      'checkout_analytics': 'Dados Checkouts (Topo)',
      'login_page': 'Página de Login',
      'register_page': 'Página de Registro',
      'award_page': 'Página de Premiações (Topo)'
    };
    return positions[position] || position;
  };

  // Admin jverificado pelo AdminRoute - no precisa verificar novamente

  return (
    <DashboardLayout>
      <div className="space-y-6" data-testid="admin-banners-page">
        {/* Cabealho */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Image className="w-8 h-8 text-brand-muted-foreground" />
              <h1 className="text-3xl font-bold tracking-tight">Gerenciar Banners</h1>
            </div>
            <p className="text-muted-foreground">
              Configure os banners que aparecem no dashboard dos sellers
            </p>
          </div>
          <Badge variant="outline" className="text-brand-muted-foreground border-brand-muted">
            <Image className="w-4 h-4 mr-1 text-brand-muted-foreground" />
            {filteredBanners.length} banner{filteredBanners.length !== 1 ? 's' : ''} encontrado{filteredBanners.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Filtros e Busca */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />
                <Input
                  placeholder="Buscar por URL ou link..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-banner"
                />
              </div>
              <Dialog open={isCreating} onOpenChange={setIsCreating}>
                <DialogTrigger asChild>
                  <Button onClick={() => { resetForm(); setIsCreating(true); }} data-testid="button-create-banner">
                    <Plus className="w-4 h-4 mr-2" />
                    Novo Banner
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Image className="w-5 h-5 text-brand-muted-foreground" />
                      Criar Novo Banner
                    </DialogTitle>
                    <DialogDescription>
                      Configure um novo banner para exibir no dashboard dos sellers (1600x256 pixels)
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <Label>Upload de Imagem * (1600x256 pixels)</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (isUploading) return;
                          
                          try {
                            setIsUploading(true);
                            const uploadFormData = new FormData();
                            uploadFormData.append('file', file);
                            
                            // IMPORTANTE: NÃO adicionar Content-Type com FormData!
                            // O navegador define automaticamente com boundary correto
                            const token = await getAuthToken();
                            const headers: Record<string, string> = {};
                            if (token) {
                              headers['Authorization'] = `Bearer ${token}`;
                            }
                            
                            const response = await fetch('/api/admin/upload-banner', {
                              method: 'POST',
                              headers,
                              body: uploadFormData,
                              credentials: 'include'
                            });
                            
                            if (!response.ok) throw new Error('Erro no upload');
                            
                            const data = await response.json();
                            setFormData(prev => ({ ...prev, imageUrl: data.url }));
                            
                            toast({
                              title: "Sucesso",
                              description: "Imagem enviada! URL permanente criada.",
                            });
                          } catch (error) {
                            console.error('Erro no upload:', error);
                            toast({
                              title: "Erro",
                              description: "Erro ao fazer upload da imagem.",
                              variant: "destructive",
                            });
                          } finally {
                            setIsUploading(false);
                          }
                        }}
                        disabled={isUploading}
                        data-testid="input-banner-upload"
                      />
                      {isUploading && <p className="text-sm text-muted-foreground mt-1">Fazendo upload...</p>}
                      {formData.imageUrl && (
                        <div className="mt-3 p-3 bg-emerald-50 dark:bg-gray-700 rounded-lg border border-emerald-200 dark:border-[#f0f4ff]">
                          <p className="text-sm text-emerald-600 dark:text-blue-400 font-medium mb-2">Imagem carregada com sucesso!</p>
                          <div className="bg-white dark:bg-gray-700 dark:backdrop-blur-md p-2 rounded border">
                            <img 
                              src={resolveImageUrl(formData.imageUrl) || ''} 
                              alt="Preview do Banner" 
                              className="w-full h-auto rounded shadow-sm"
                              style={{ maxHeight: '200px', objectFit: 'contain' }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-2 truncate">{formData.imageUrl}</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <Label>Link (opcional)</Label>
                      <Input
                        value={formData.link || ""}
                        onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                        placeholder="https://exemplo.com/promo"
                        data-testid="input-banner-link"
                      />
                    </div>
                    <div>
                      <Label>Posio do Banner</Label>
                      <Select 
                        value={formData.position || "dashboard_top"} 
                        onValueChange={(value) => setFormData({ ...formData, position: value as any })}
                      >
                        <SelectTrigger data-testid="select-banner-position">
                          <SelectValue placeholder="Selecione a posio" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dashboard_top">Dashboard (Topo)</SelectItem>
                          <SelectItem value="showcase">Vitrine Pública (Topo)</SelectItem>
                          <SelectItem value="checkout_analytics">Dados Checkouts (Topo)</SelectItem>
                          <SelectItem value="login_page">Página de Login (Lateral)</SelectItem>
                          <SelectItem value="register_page">Página de Registro (Lateral)</SelectItem>
                          <SelectItem value="award_page">Página de Premiações (Topo)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Prioridade (0 = mais alta)</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={formData.priority || 0}
                          onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                          data-testid="input-banner-priority"
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={formData.isActive}
                            onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                            data-testid="switch-banner-active"
                          />
                          <Label>Banner ativo</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={formData.targetBlank}
                            onCheckedChange={(checked) => setFormData({ ...formData, targetBlank: checked })}
                            data-testid="switch-banner-target-blank"
                          />
                          <Label>Abrir em nova aba</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-6">
                    <Button variant="outline" onClick={() => setIsCreating(false)} data-testid="button-cancel-banner">
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleSaveBanner} 
                      disabled={isSaving}
                      data-testid="button-save-banner"
                    >
                      {isSaving ? 'Criando...' : 'Criar Banner'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        {/* Tabela de Banners */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Carregando banners...</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Preview</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead className="text-right">Aes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBanners.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? 'Nenhum banner encontrado com os filtros aplicados.' : 'Nenhum banner criado ainda.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredBanners.map((banner) => (
                      <TableRow key={banner.id} data-testid={`row-banner-${banner.id}`}>
                        <TableCell>
                          <div className="w-32 h-10 bg-brand-subtle dark:bg-gray-700 dark:backdrop-blur-md rounded-md overflow-hidden border border-brand-muted dark:border-emerald-500/20">
                            <img
                              src={resolveImageUrl(banner.imageUrl) || ''}
                              alt={banner.description || "Banner"}
                              className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                              loading="lazy"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const parent = img.parentElement;
                                if (parent) {
                                  parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-xs text-brand-muted-foreground"></div>';
                                }
                              }}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-emerald-900/10 border-emerald-700/30">
                            {getPositionName(banner.position)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(banner)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{banner.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          {banner.link ? (
                            <div className="flex items-center gap-1">
                              <ExternalLink className="w-3 h-3 text-emerald-700" />
                              <span className="text-muted-foreground text-sm truncate max-w-24">{banner.link}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" data-testid={`button-view-banner-${banner.id}`}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl">
                                <DialogHeader>
                                  <DialogTitle>Preview do Banner</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="bg-brand-subtle p-4 rounded">
                                    <img
                                      src={resolveImageUrl(banner.imageUrl) || ''}
                                      alt={banner.description || "Banner"}
                                      className="w-full max-w-2xl mx-auto rounded shadow"
                                      style={{ aspectRatio: '1600/256' }}
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <strong>Status:</strong> {banner.isActive ? 'Ativo' : 'Inativo'}
                                    </div>
                                    <div>
                                      <strong>Prioridade:</strong> {banner.priority}
                                    </div>
                                    <div>
                                      <strong>Link:</strong> {banner.link || 'Nenhum'}
                                    </div>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                            
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleBannerStatus(banner)}
                              data-testid={`button-toggle-banner-${banner.id}`}
                            >
                              {banner.isActive ? <XCircle className="w-4 h-4 text-emerald-700" /> : <CheckCircle className="w-4 h-4 text-emerald-700" />}
                            </Button>

                            <Dialog open={isEditing && selectedBanner?.id === banner.id} onOpenChange={(open) => {
                              if (!open) {
                                setIsEditing(false);
                                setSelectedBanner(null);
                              }
                            }}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => openEditDialog(banner)} data-testid={`button-edit-banner-${banner.id}`}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-2">
                                    <Edit className="w-5 h-5 text-brand-muted-foreground" />
                                    Editar Banner
                                  </DialogTitle>
                                  <DialogDescription>
                                    Atualize as informações do banner
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid grid-cols-1 gap-4">
                                  <div>
                                    <Label>Upload de Nova Imagem (1600x256 pixels)</Label>
                                    <Input
                                      type="file"
                                      accept="image/*"
                                      onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        
                                        if (isUploading) return;
                                        
                                        try {
                                          setIsUploading(true);
                                          const uploadFormData = new FormData();
                                          uploadFormData.append('file', file);
                                          
                                          const token = await getAuthToken();
                                          const headers: Record<string, string> = {};
                                          if (token) {
                                            headers['Authorization'] = `Bearer ${token}`;
                                          }
                                          
                                          const response = await fetch('/api/admin/upload-banner', {
                                            method: 'POST',
                                            headers,
                                            body: uploadFormData,
                                            credentials: 'include'
                                          });
                                          
                                          if (!response.ok) throw new Error('Erro no upload');
                                          
                                          const data = await response.json();
                                          setFormData(prev => ({ ...prev, imageUrl: data.url }));
                                          
                                          toast({
                                            title: "Sucesso",
                                            description: "Nova imagem enviada! URL permanente criada.",
                                          });
                                        } catch (error) {
                                          console.error('Erro no upload:', error);
                                          toast({
                                            title: "Erro",
                                            description: "Erro ao fazer upload da imagem.",
                                            variant: "destructive",
                                          });
                                        } finally {
                                          setIsUploading(false);
                                        }
                                      }}
                                      disabled={isUploading}
                                      data-testid="input-edit-banner-upload"
                                    />
                                    {isUploading && <p className="text-sm text-muted-foreground mt-1">Fazendo upload...</p>}
                                    {formData.imageUrl && (
                                      <div className="mt-3 p-3 bg-emerald-50 dark:bg-gray-700 rounded-lg border border-emerald-200 dark:border-[#f0f4ff]">
                                        <p className="text-sm text-emerald-600 dark:text-blue-400 font-medium mb-2">Imagem Atual</p>
                                        <div className="bg-white dark:bg-gray-700 dark:backdrop-blur-md p-2 rounded border">
                                          <img 
                                            src={resolveImageUrl(formData.imageUrl) || ''} 
                                            alt="Preview do Banner" 
                                            className="w-full h-auto rounded shadow-sm"
                                            style={{ maxHeight: '200px', objectFit: 'contain' }}
                                            onError={(e) => {
                                              (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                          />
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-2 truncate">{formData.imageUrl}</p>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <Label>Link (opcional)</Label>
                                    <Input
                                      value={formData.link ?? ""}
                                      onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                                      placeholder="https://exemplo.com/promo"
                                      data-testid="input-edit-banner-link"
                                    />
                                  </div>
                                  <div>
                                    <Label>Posio do Banner</Label>
                                    <Select 
                                      value={formData.position || "dashboard_top"} 
                                      onValueChange={(value) => setFormData({ ...formData, position: value as any })}
                                    >
                                      <SelectTrigger data-testid="select-edit-banner-position">
                                        <SelectValue placeholder="Selecione a posio" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="dashboard_top">Dashboard (Topo)</SelectItem>
                                        <SelectItem value="showcase">Vitrine Pública (Topo)</SelectItem>
                                        <SelectItem value="checkout_analytics">Dados Checkouts (Topo)</SelectItem>
                                        <SelectItem value="login_page">Página de Login (Lateral)</SelectItem>
                                        <SelectItem value="register_page">Página de Registro (Lateral)</SelectItem>
                                        <SelectItem value="award_page">Página de Premiações (Topo)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <Label>Prioridade (0 = mais alta)</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={formData.priority}
                                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                                        data-testid="input-edit-banner-priority"
                                      />
                                    </div>
                                    <div className="space-y-3">
                                      <div className="flex items-center space-x-2">
                                        <Switch
                                          checked={formData.isActive}
                                          onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                                          data-testid="switch-edit-banner-active"
                                        />
                                        <Label>Banner ativo</Label>
                                      </div>
                                      <div className="flex items-center space-x-2">
                                        <Switch
                                          checked={formData.targetBlank}
                                          onCheckedChange={(checked) => setFormData({ ...formData, targetBlank: checked })}
                                          data-testid="switch-edit-banner-target-blank"
                                        />
                                        <Label>Abrir em nova aba</Label>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex justify-end gap-2 mt-6">
                                  <Button variant="outline" onClick={() => { setIsEditing(false); setSelectedBanner(null); }} data-testid="button-cancel-edit-banner">
                                    Cancelar
                                  </Button>
                                  <Button 
                                    onClick={handleSaveBanner} 
                                    disabled={isSaving}
                                    data-testid="button-update-banner"
                                  >
                                    {isSaving ? 'Atualizando...' : 'Atualizar Banner'}
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteBanner(banner)}
                              className="text-emerald-700 hover:text-emerald-700"
                              data-testid={`button-delete-banner-${banner.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}