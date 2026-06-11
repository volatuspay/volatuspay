import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Edit2, Trash2, Copy, Check, Percent, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface CouponManagerProps {
  productId: string;
  type?: 'product' | 'checkout';
}

interface ProductOffer {
  id: string;
  title: string;
  price: number;
  slug: string;
  active: boolean;
}

interface Coupon {
  id: string;
  code: string;
  name: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  minAmount?: number;
  maxAmount?: number;
  usageLimit?: number;
  usedCount: number;
  validFrom: Date;
  validUntil: Date;
  active: boolean;
  productId?: string;
  offerId?: string;
  tenantId: string;
}

const toDisplayDate = (d: Date | string | undefined): string => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

const parseDisplayDate = (str: string): Date | null => {
  if (!str || str.length < 10) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (!d || !m || !y || y < 2024 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
};

const makeDateInput = (value: string, onChange: (v: string) => void) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/[^0-9]/g, '');
    let formatted = digits;
    if (digits.length >= 2) formatted = digits.slice(0, 2) + '/' + digits.slice(2);
    if (digits.length >= 4) formatted = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
    onChange(formatted);
  };
  const isInvalid = value.length === 10 && !parseDisplayDate(value);
  return { value, onChange: handleChange, maxLength: 10, isInvalid };
};

const defaultFormData = () => {
  return {
    code: '',
    name: '',
    type: 'percentage' as 'percentage' | 'fixed_amount',
    value: 0,
    minAmount: 0,
    usageLimit: 0,
    validFrom: toDisplayDate(new Date()),
    validUntil: toDisplayDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    active: true,
    offerId: '',
  };
};

type FormData = ReturnType<typeof defaultFormData>;

export function CouponManager({ productId, type = 'product' }: CouponManagerProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>(defaultFormData());
  const [editFormData, setEditFormData] = useState<FormData>(defaultFormData());

  const apiBase = type === 'checkout' ? `/api/checkouts` : `/api/products`;

  const { data: coupons = [], isLoading } = useQuery<Coupon[]>({
    queryKey: ['coupons', type, productId],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`${apiBase}/${productId}/coupons`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      return result.coupons || [];
    },
  });

  const { data: offers = [] } = useQuery<ProductOffer[]>({
    queryKey: ['offers-for-coupon', productId],
    enabled: type === 'product',
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/products/${productId}/offers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data.filter((o: any) => o.active !== false) : [];
    },
  });

  const buildPayload = (form: FormData) => {
    const validFrom = parseDisplayDate(form.validFrom) || new Date();
    const validUntil = parseDisplayDate(form.validUntil) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const valueToSend = form.type === 'fixed_amount' ? Math.round(form.value * 100) : form.value;
    return {
      code: form.code.toUpperCase(),
      name: form.name,
      type: form.type,
      value: valueToSend,
      minAmount: form.minAmount || 0,
      usageLimit: form.usageLimit || 0,
      validFrom,
      validUntil,
      active: form.active,
      ...(form.offerId ? { offerId: form.offerId } : {}),
    };
  };

  const createMutation = useMutation({
    mutationFn: async (form: FormData) => {
      const token = await auth.currentUser?.getIdToken();
      const payload = buildPayload(form);
      const response = await fetch(`${apiBase}/${productId}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao criar cupom');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons', type, productId] });
      toast({ title: 'Cupom criado com sucesso!' });
      setIsCreateOpen(false);
      setFormData(defaultFormData());
    },
    onError: (error: any) => {
      toast({ title: 'Erro ao criar cupom', description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: FormData }) => {
      const token = await auth.currentUser?.getIdToken();
      const payload = buildPayload(form);
      const response = await fetch(`${apiBase}/${productId}/coupons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao atualizar cupom');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons', type, productId] });
      toast({ title: 'Cupom atualizado!' });
      setIsEditOpen(false);
      setEditingCoupon(null);
    },
    onError: (error: any) => {
      toast({ title: 'Erro ao atualizar cupom', description: error.message, variant: 'destructive' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`${apiBase}/${productId}/coupons/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ active }),
      });
      if (!response.ok) throw new Error('Erro ao atualizar cupom');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons', type, productId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`${apiBase}/${productId}/coupons/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao excluir cupom');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coupons', type, productId] });
      toast({ title: 'Cupom excluído!' });
    },
    onError: (error: any) => {
      toast({ title: 'Erro ao excluir cupom', description: error.message, variant: 'destructive' });
    },
  });

  const handleOpenCreate = () => {
    setFormData(defaultFormData());
    setIsCreateOpen(true);
  };

  const handleOpenEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setEditFormData({
      code: coupon.code,
      name: coupon.name,
      type: coupon.type,
      value: coupon.type === 'fixed_amount' ? coupon.value / 100 : coupon.value,
      minAmount: coupon.minAmount || 0,
      usageLimit: coupon.usageLimit || 0,
      validFrom: toDisplayDate(coupon.validFrom),
      validUntil: toDisplayDate(coupon.validUntil),
      active: coupon.active,
      offerId: coupon.offerId || '',
    });
    setIsEditOpen(true);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast({ title: 'Código copiado!' });
  };

  const formatDiscount = (coupon: Coupon) => {
    if (coupon.type === 'percentage') return `${coupon.value}%`;
    return `R$ ${(coupon.value / 100).toFixed(2)}`;
  };

  const renderFormFields = (data: FormData, setData: (d: FormData) => void, isEdit = false) => {
    const fromInput = makeDateInput(data.validFrom, (v) => setData({ ...data, validFrom: v }));
    const untilInput = makeDateInput(data.validUntil, (v) => setData({ ...data, validUntil: v }));

    return (
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Código do Cupom</Label>
            <Input
              placeholder="DESCONTO20"
              value={data.code}
              onChange={(e) => setData({ ...data, code: e.target.value.toUpperCase() })}
              disabled={isEdit}
              data-testid="input-coupon-code"
            />
          </div>
          <div className="space-y-2">
            <Label>Nome do Cupom</Label>
            <Input
              placeholder="Desconto de Lançamento"
              value={data.name}
              onChange={(e) => setData({ ...data, name: e.target.value })}
              data-testid="input-coupon-name"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Tipo de Desconto</Label>
            <Select
              value={data.type}
              onValueChange={(v: 'percentage' | 'fixed_amount') => setData({ ...data, type: v })}
            >
              <SelectTrigger data-testid="select-discount-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">
                  <div className="flex items-center"><Percent className="mr-2 h-4 w-4" />Porcentagem</div>
                </SelectItem>
                <SelectItem value="fixed_amount">
                  <div className="flex items-center"><DollarSign className="mr-2 h-4 w-4" />Valor Fixo (R$)</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>
              Valor{data.type === 'fixed_amount' ? ' (R$)' : ' (%)'}
            </Label>
            <Input
              type="number"
              step={data.type === 'fixed_amount' ? '0.01' : '1'}
              min="0"
              placeholder={data.type === 'fixed_amount' ? 'Ex: 5.00' : 'Ex: 10'}
              value={data.value}
              onChange={(e) => setData({ ...data, value: Number(e.target.value) })}
              data-testid="input-discount-value"
            />
            {data.type === 'fixed_amount' && (
              <p className="text-xs text-muted-foreground">Digite em reais (ex: 5.00 = R$ 5,00)</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Início (DD/MM/AAAA)</Label>
            <Input
              type="text"
              placeholder="25/05/2026"
              value={fromInput.value}
              onChange={fromInput.onChange}
              maxLength={fromInput.maxLength}
              data-testid="input-valid-from"
            />
            {fromInput.isInvalid && <p className="text-xs text-red-500">Data inválida. Use DD/MM/AAAA</p>}
          </div>
          <div className="space-y-2">
            <Label>Expiração (DD/MM/AAAA)</Label>
            <Input
              type="text"
              placeholder="24/06/2026"
              value={untilInput.value}
              onChange={untilInput.onChange}
              maxLength={untilInput.maxLength}
              data-testid="input-valid-until"
            />
            {untilInput.isInvalid && <p className="text-xs text-red-500">Data inválida. Use DD/MM/AAAA</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Limite de Usos (0 = ilimitado)</Label>
            <Input
              type="number"
              min="0"
              value={data.usageLimit}
              onChange={(e) => setData({ ...data, usageLimit: Number(e.target.value) })}
              data-testid="input-usage-limit"
            />
          </div>
          <div className="space-y-2">
            <Label>Valor Mínimo da Compra (R$)</Label>
            <Input
              type="number"
              min="0"
              value={data.minAmount}
              onChange={(e) => setData({ ...data, minAmount: Number(e.target.value) })}
              data-testid="input-min-amount"
            />
          </div>
        </div>

        {type === 'product' && (
          <div className="space-y-2">
            <Label>Aplicar em</Label>
            <Select
              value={data.offerId || '__all__'}
              onValueChange={(v) => setData({ ...data, offerId: v === '__all__' ? '' : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas as ofertas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as ofertas do produto</SelectItem>
                {offers.map((offer) => (
                  <SelectItem key={offer.id} value={offer.id}>
                    {offer.title} — R$ {(offer.price / 100).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {data.offerId
                ? 'Cupom válido apenas para a oferta selecionada'
                : 'Cupom válido para todas as ofertas'}
            </p>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <Switch
            checked={data.active}
            onCheckedChange={(checked) => setData({ ...data, active: checked })}
            data-testid="switch-active"
          />
          <Label>Cupom ativo</Label>
        </div>
      </div>
    );
  };

  const isFormValid = (form: FormData) =>
    form.code.length >= 3 &&
    form.name.length >= 1 &&
    !!parseDisplayDate(form.validFrom) &&
    !!parseDisplayDate(form.validUntil) &&
    form.value > 0;

  if (isLoading) {
    return <div className="text-center p-8">Carregando cupons...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Cupons de Desconto</h3>
          <p className="text-sm text-muted-foreground">
            Crie e gerencie cupons de desconto para este produto
          </p>
        </div>
        <Button type="button" onClick={handleOpenCreate} data-testid="button-create-coupon">
          <Plus className="mr-2 h-4 w-4" />
          Criar Cupom
        </Button>
      </div>

      {/* Criar Cupom */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Criar Novo Cupom</DialogTitle>
            <DialogDescription>Configure o cupom de desconto para seus clientes</DialogDescription>
          </DialogHeader>
          {renderFormFields(formData, setFormData)}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              onClick={() => createMutation.mutate(formData)}
              disabled={createMutation.isPending || !isFormValid(formData)}
              data-testid="button-save-coupon"
            >
              {createMutation.isPending ? 'Criando...' : 'Criar Cupom'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Editar Cupom */}
      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => { if (!open) { setIsEditOpen(false); setEditingCoupon(null); } }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Cupom</DialogTitle>
            <DialogDescription>
              Atualize as configurações do cupom "{editingCoupon?.code}"
            </DialogDescription>
          </DialogHeader>
          {renderFormFields(editFormData, setEditFormData, true)}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setIsEditOpen(false); setEditingCoupon(null); }}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => editingCoupon && updateMutation.mutate({ id: editingCoupon.id, form: editFormData })}
              disabled={updateMutation.isPending || !isFormValid(editFormData)}
            >
              {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {coupons.length === 0 ? (
        <EmptyState
          icon={Percent}
          title="Nenhum cupom criado"
          description="Crie cupons de desconto para atrair mais clientes"
          action={
            <Button type="button" onClick={handleOpenCreate} data-testid="button-create-first-coupon">
              <Plus className="mr-2 h-4 w-4" />
              Criar Primeiro Cupom
            </Button>
          }
        />
      ) : (
        <Card className="bg-white dark:bg-gray-700 border-slate-200 dark:border-slate-700 shadow-sm">
          <CardHeader>
            <CardTitle>Cupons Cadastrados</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Desconto</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coupons.map((coupon) => (
                  <TableRow key={coupon.id} data-testid={`row-coupon-${coupon.id}`}>
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-2">
                        {coupon.code}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyCode(coupon.code)}
                          data-testid={`button-copy-${coupon.id}`}
                        >
                          {copiedCode === coupon.code
                            ? <Check className="h-3 w-3 text-emerald-500" />
                            : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span>{coupon.name}</span>
                        {coupon.offerId && (
                          <span className="block text-xs text-muted-foreground">Oferta específica</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDiscount(coupon)}</TableCell>
                    <TableCell>
                      {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ' / ∞'}
                    </TableCell>
                    <TableCell>
                      {new Date(coupon.validUntil).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={coupon.active ? 'default' : 'secondary'}>
                        {coupon.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(coupon)}
                          data-testid={`button-edit-${coupon.id}`}
                          title="Editar cupom"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleMutation.mutate({ id: coupon.id, active: !coupon.active })}
                          data-testid={`button-toggle-${coupon.id}`}
                        >
                          {coupon.active ? 'Desativar' : 'Ativar'}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" data-testid={`button-delete-${coupon.id}`}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir Cupom</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir o cupom "{coupon.code}"? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(coupon.id)}
                                className="bg-red-500 hover:bg-red-600"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
