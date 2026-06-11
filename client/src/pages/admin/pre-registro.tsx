import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { User, Search, Download, Clock, Mail, UserPlus, FileText, CheckCircle, Phone } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { apiRequest } from "@/lib/queryClient";

interface PreRegistro {
  id: string;
  email: string;
  name: string;
  phone: string;
  createdAt: string | null;
  emailVerified: boolean;
  hasSellerDoc: boolean;
  profileComplete: boolean;
  status: string;
  businessName: string;
  document: string;
}

export default function AdminPreRegistro() {
  const [allItems, setAllItems] = useState<PreRegistro[]>([]);
  const [filteredItems, setFilteredItems] = useState<PreRegistro[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 15;
  const { toast } = useToast();

  useEffect(() => {
    const loadPreRegistros = async () => {
      try {
        const response = await apiRequest('/api/admin/pre-registros', 'GET');
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error('API error');
        setAllItems(data.preRegistros || []);
      } catch (error) {
        console.error('Erro ao carregar pré-registros:', error);
        toast({
          title: "Erro ao carregar pré-registros",
          description: "Verifique a conexão e tente novamente",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    loadPreRegistros();
  }, []);

  useEffect(() => {
    let filtered = allItems;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.email?.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        s.businessName?.toLowerCase().includes(q)
      );
    }
    setFilteredItems(filtered);
    setCurrentPage(1);
  }, [allItems, searchQuery]);

  const handleExportCSV = () => {
    if (filteredItems.length === 0) {
      toast({ title: "Nenhum dado para exportar", variant: "destructive" });
      return;
    }
    const headers = ["Nome", "Email", "Telefone", "Email Verificado", "Tem Cadastro", "Data de Registro"];
    const rows = filteredItems.map(s => [
      s.name || s.businessName || "N/A",
      s.email || "N/A",
      s.phone || "N/A",
      s.emailVerified ? "Sim" : "Não",
      s.hasSellerDoc ? "Sim" : "Não",
      s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : "N/A",
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pre-registros-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: `${filteredItems.length} registros exportados` });
  };

  const startIndex = (currentPage - 1) * perPage;
  const currentItems = filteredItems.slice(startIndex, startIndex + perPage);
  const totalPages = Math.ceil(filteredItems.length / perPage);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-pre-registro-title">Pré-Registro</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Usuários que se registraram mas ainda não enviaram os documentos para verificação
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm">
              {filteredItems.length} usuário{filteredItems.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              onClick={handleExportCSV}
              variant="outline"
              className="gap-2"
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-pre-registro"
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-muted rounded-full" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-muted rounded w-1/3" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8">
                <UserPlus className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">Nenhum pré-registro encontrado</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {searchQuery
                    ? `Nenhum resultado para "${searchQuery}"`
                    : "Todos os usuários registrados já enviaram seus documentos para verificação"}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {currentItems.map((item) => (
              <Card key={item.id} data-testid={`card-pre-registro-${item.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground truncate">
                          {item.name || item.businessName || "Sem nome"}
                        </span>
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Aguardando Docs
                        </Badge>
                        {item.emailVerified && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-green-300">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Email Verificado
                          </Badge>
                        )}
                        {item.hasSellerDoc && (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                            <FileText className="h-3 w-3 mr-1" />
                            Cadastro Iniciado
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {item.email}
                        </span>
                        {item.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {item.phone.length === 11
                              ? `(${item.phone.slice(0,2)}) ${item.phone.slice(2,7)}-${item.phone.slice(7)}`
                              : item.phone.length === 10
                              ? `(${item.phone.slice(0,2)}) ${item.phone.slice(2,6)}-${item.phone.slice(6)}`
                              : item.phone}
                          </span>
                        )}
                        {item.createdAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page"
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="button-next-page"
                >
                  Próxima
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
