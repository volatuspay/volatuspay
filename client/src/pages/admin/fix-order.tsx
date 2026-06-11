import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Search, CheckCircle, Loader2 } from 'lucide-react';

export default function FixOrderPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  
  const [sellerEmail, setSellerEmail] = useState('marcelojrfer@gmail.com');
  const [customerEmail, setCustomerEmail] = useState('');
  const [newStatus, setNewStatus] = useState('pending');

  // Buscar vendas do seller
  const handleSearch = async () => {
    if (!sellerEmail) {
      toast({
        title: 'Erro',
        description: 'Email do seller é obrigatório',
        variant: 'destructive'
      });
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(`/api/orders/admin/search-orders?sellerEmail=${encodeURIComponent(sellerEmail)}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar vendas');
      }

      const data = await response.json();
      setOrders(data.orders);

      toast({
        title: 'Vendas encontradas',
        description: `${data.totalOrders} vendas encontradas para ${sellerEmail}`
      });

    } catch (error) {
      console.error('Erro ao buscar vendas:', error);
      toast({
        title: 'Erro',
        description: 'Erro ao buscar vendas do seller',
        variant: 'destructive'
      });
    } finally {
      setSearching(false);
    }
  };

  // Corrigir status da venda
  const handleFix = async () => {
    if (!customerEmail || !sellerEmail || !newStatus) {
      toast({
        title: 'Erro',
        description: 'Preencha todos os campos',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/orders/admin/fix-order-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          customerEmail,
          sellerEmail,
          newStatus
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao corrigir venda');
      }

      const data = await response.json();

      toast({
        title: 'Status corrigido com sucesso',
        description: `Venda de ${data.order.customerName} alterada de ${data.order.oldStatus} para ${data.order.newStatus}`
      });

      // Recarregar lista
      handleSearch();

    } catch (error: any) {
      console.error('Erro ao corrigir venda:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao corrigir status da venda',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      paid: { variant: 'default', label: 'Pago' },
      pending: { variant: 'secondary', label: 'Pendente' },
      expired: { variant: 'destructive', label: 'Expirado' },
      refunded: { variant: 'outline', label: 'Reembolsado' },
    };

    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Correção de Status de Vendas</h1>
        <p className="text-muted-foreground">
          Ferramenta administrativa para corrigir status incorretos de vendas
        </p>
      </div>

      {/* Buscar Vendas */}
      <Card>
        <CardHeader>
          <CardTitle>Buscar Vendas do Seller</CardTitle>
          <CardDescription>
            Liste todas as vendas de um seller para identificar problemas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="searchSellerEmail">Email do Seller</Label>
            <div className="flex gap-2">
              <Input
                id="searchSellerEmail"
                type="email"
                value={sellerEmail}
                onChange={(e) => setSellerEmail(e.target.value)}
                placeholder="seller@example.com"
              />
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Buscando...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Buscar
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Lista de Vendas */}
          {orders.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium">Cliente</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Email</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Produto</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Valor</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map((order) => (
                      <tr 
                        key={order.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => setCustomerEmail(order.customerEmail)}
                      >
                        <td className="px-4 py-3 text-sm">{order.customerName}</td>
                        <td className="px-4 py-3 text-sm">{order.customerEmail}</td>
                        <td className="px-4 py-3 text-sm">{order.checkoutTitle}</td>
                        <td className="px-4 py-3 text-sm">R$ {(order.amount / 100).toFixed(2)}</td>
                        <td className="px-4 py-3">{getStatusBadge(order.status)}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {new Date(order.createdAt._seconds * 1000).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Corrigir Venda Específica */}
      <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-600" />
            Corrigir Status de Venda
          </CardTitle>
          <CardDescription>
            ATENÇÃO: Esta ação altera diretamente o status da venda no banco de dados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="sellerEmail">Email do Seller</Label>
              <Input
                id="sellerEmail"
                type="email"
                value={sellerEmail}
                onChange={(e) => setSellerEmail(e.target.value)}
                placeholder="seller@example.com"
              />
            </div>

            <div>
              <Label htmlFor="customerEmail">Email do Cliente</Label>
              <Input
                id="customerEmail"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="cliente@example.com"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="newStatus">Novo Status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o novo status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="expired">Expirado</SelectItem>
                <SelectItem value="refunded">Reembolsado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Avisãos */}
          <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Instruções:
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1 list-disc list-inside">
              <li>Venda do <strong>Ricardo Chagas</strong> (r.chagas902@gmail.com): marcar como PENDENTE</li>
              <li>Venda do <strong>Marco Antonio</strong> (metaversovirtual33@gmail.com): manter como PAGO</li>
              <li>Clique na venda da tabela acima para preencher automaticamente o email do cliente</li>
            </ul>
          </div>

          <Button 
            onClick={handleFix} 
            disabled={loading}
            className="w-full"
            variant="destructive"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Corrigindo...
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                Corrigir Status da Venda
              </>
            )}
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
