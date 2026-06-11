import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Landmark, Save, Loader2, CheckCircle2, KeyRound, Search, ChevronDown, X } from "lucide-react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth";
import { auth } from "@/lib/firebase";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface BankingData {
  holderName: string;
  holderDocument: string;
  bankName: string;
  bankCode: string;
  agency: string;
  accountNumber: string;
  accountType: string;
  pixKeyType: string;
  pixKey: string;
  updatedAt?: string;
}

const BANKS = [
  { code: "001", name: "Banco do Brasil" },
  { code: "003", name: "Banco da Amazônia" },
  { code: "004", name: "Banco do Nordeste" },
  { code: "010", name: "Credicoamo" },
  { code: "021", name: "Banestes" },
  { code: "025", name: "Banco Alfa" },
  { code: "029", name: "Banco Itaú Consignado" },
  { code: "033", name: "Santander" },
  { code: "036", name: "Banco Bradesco BBI" },
  { code: "037", name: "Banco do Estado do Pará" },
  { code: "041", name: "Banrisul" },
  { code: "047", name: "Banco do Estado de Sergipe" },
  { code: "062", name: "Hipercard" },
  { code: "066", name: "Banco Morgan Stanley" },
  { code: "069", name: "Crefisa" },
  { code: "070", name: "BRB - Banco de Brasília" },
  { code: "074", name: "Banco J. Safra" },
  { code: "077", name: "Banco Inter" },
  { code: "082", name: "Banco Topázio" },
  { code: "084", name: "Uniprime Norte do Paraná" },
  { code: "085", name: "Cooperativa Central Ailos" },
  { code: "089", name: "Cooperativa de Crédito Rural da Região da Mogiana" },
  { code: "091", name: "Unicred Central RS" },
  { code: "093", name: "Polocred" },
  { code: "097", name: "Cooperativa Central de Crédito Noroeste Brasileiro" },
  { code: "099", name: "Uniprime Central" },
  { code: "104", name: "Caixa Econômica Federal" },
  { code: "107", name: "Banco BBM" },
  { code: "121", name: "Banco Agibank" },
  { code: "133", name: "Cresol Confederação" },
  { code: "136", name: "Unicred" },
  { code: "169", name: "Banco Olé Bonsucesso Consignado" },
  { code: "174", name: "Pefisa" },
  { code: "197", name: "Stone Pagamentos" },
  { code: "208", name: "Banco BTG Pactual" },
  { code: "212", name: "Banco Original" },
  { code: "218", name: "Banco BS2" },
  { code: "222", name: "Banco Crédit Agricole Brasil" },
  { code: "237", name: "Bradesco" },
  { code: "246", name: "Banco ABC Brasil" },
  { code: "254", name: "Paraná Banco" },
  { code: "260", name: "Nubank (Nu Pagamentos)" },
  { code: "265", name: "Banco Fator" },
  { code: "269", name: "HSBC Brasil" },
  { code: "274", name: "Money Plus" },
  { code: "276", name: "Banco Senff" },
  { code: "280", name: "Will Financeira (Avista)" },
  { code: "290", name: "PagSeguro (PagBank)" },
  { code: "301", name: "BPP Instituição de Pagamento" },
  { code: "310", name: "Vortx" },
  { code: "318", name: "Banco BMG" },
  { code: "320", name: "Banco CCB Brasil" },
  { code: "323", name: "Mercado Pago" },
  { code: "329", name: "QI Sociedade de Crédito Direto" },
  { code: "330", name: "Banco Bari" },
  { code: "335", name: "Banco Digio" },
  { code: "336", name: "C6 Bank" },
  { code: "341", name: "Itaú Unibanco" },
  { code: "364", name: "Gerencianet (EfíBank)" },
  { code: "376", name: "Banco J.P. Morgan" },
  { code: "380", name: "PicPay" },
  { code: "389", name: "Banco Mercantil do Brasil" },
  { code: "394", name: "Banco Bradesco Financiamentos" },
  { code: "399", name: "Kirton Bank" },
  { code: "403", name: "Cora" },
  { code: "412", name: "Banco Capital" },
  { code: "422", name: "Banco Safra" },
  { code: "456", name: "Banco MUFG Brasil" },
  { code: "473", name: "Banco Caixa Geral - Brasil" },
  { code: "487", name: "Banco Deutsche" },
  { code: "604", name: "Banco Industrial do Brasil" },
  { code: "611", name: "Banco Paulista" },
  { code: "612", name: "Banco Guanabara" },
  { code: "613", name: "Omni Banco" },
  { code: "623", name: "Banco Pan" },
  { code: "626", name: "Banco C6 Consignado" },
  { code: "630", name: "Banco Intercap (Smartbank)" },
  { code: "633", name: "Banco Rendimento" },
  { code: "634", name: "Banco Triângulo" },
  { code: "637", name: "Banco Sofisa" },
  { code: "643", name: "Banco Pine" },
  { code: "654", name: "Banco Digimais" },
  { code: "655", name: "Neon (Votorantim)" },
  { code: "707", name: "Banco Daycoval" },
  { code: "735", name: "Banco Neon" },
  { code: "739", name: "Banco Cetelem" },
  { code: "741", name: "Banco Ribeirão Preto" },
  { code: "743", name: "Banco Semear" },
  { code: "745", name: "Citibank" },
  { code: "746", name: "Banco Modal" },
  { code: "748", name: "Sicredi" },
  { code: "752", name: "Banco BNP Paribas Brasil" },
  { code: "756", name: "Sicoob" },
  { code: "757", name: "Banco KEB Hana do Brasil" },
];

export default function BankingDataPage() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [formData, setFormData] = useState<BankingData>({
    holderName: "",
    holderDocument: "",
    bankName: "",
    bankCode: "",
    agency: "",
    accountNumber: "",
    accountType: "corrente",
    pixKeyType: "",
    pixKey: "",
  });
  const [saved, setSaved] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const bankDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(e.target as Node)) {
        setBankDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data, isLoading } = useQuery<{ bankingData: BankingData }>({
    queryKey: ['/api/sellers/banking-data'],
    enabled: !!user,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.bankingData) {
      setFormData({
        holderName: data.bankingData.holderName || "",
        holderDocument: data.bankingData.holderDocument || "",
        bankName: data.bankingData.bankName || "",
        bankCode: data.bankingData.bankCode || "",
        agency: data.bankingData.agency || "",
        accountNumber: data.bankingData.accountNumber || "",
        accountType: data.bankingData.accountType || "corrente",
        pixKeyType: data.bankingData.pixKeyType || "",
        pixKey: data.bankingData.pixKey || "",
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (bankingData: BankingData) => {
      const res = await apiRequest('/api/sellers/banking-data', 'PUT', bankingData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sellers/banking-data'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({
        title: "Dados salvos",
        description: "Seus dados bancários foram atualizados com sucesso.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao salvar",
        description: error.message || "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.holderName.trim()) {
      toast({ title: "Campo obrigatório", description: "Preencha o nome do titular.", variant: "destructive" });
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleBankSelect = (code: string) => {
    const bank = BANKS.find(b => b.code === code);
    setFormData(prev => ({
      ...prev,
      bankCode: code,
      bankName: bank?.name || "",
    }));
  };

  const updateField = (field: keyof BankingData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="px-4 py-6 sm:py-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-[#f0f4ff]/30 flex items-center justify-center shrink-0">
              <Landmark className="h-5 w-5 text-[#2563eb] dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white" data-testid="text-page-title">
                Dados Bancários
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Cadastre seus dados para facilitar saques e pagamentos
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

              {/* Card: Conta Bancária */}
              <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-gray-500" />
                    Dados da Conta Bancária
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Label htmlFor="holderName" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        Nome do Titular *
                      </Label>
                      <Input
                        id="holderName"
                        value={formData.holderName}
                        onChange={(e) => updateField("holderName", e.target.value)}
                        placeholder="Nome completo do titular"
                        className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                        data-testid="input-holder-name"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="holderDocument" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        CPF / CNPJ do Titular
                      </Label>
                      <Input
                        id="holderDocument"
                        value={formData.holderDocument}
                        onChange={(e) => updateField("holderDocument", e.target.value)}
                        placeholder="000.000.000-00"
                        className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                        data-testid="input-holder-document"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Banco
                    </Label>
                    <div className="relative mt-1" ref={bankDropdownRef}>
                      <button
                        type="button"
                        onClick={() => { setBankDropdownOpen(!bankDropdownOpen); setBankSearch(""); }}
                        className="flex h-10 w-full items-center justify-between rounded-md border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent px-3 py-2 text-sm text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        data-testid="select-bank"
                      >
                        <span className={formData.bankCode ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}>
                          {formData.bankCode ? `${formData.bankCode} - ${formData.bankName}` : "Selecione o banco"}
                        </span>
                        <div className="flex items-center gap-1">
                          {formData.bankCode && (
                            <span
                              role="button"
                              onClick={(e) => { e.stopPropagation(); setFormData(prev => ({ ...prev, bankCode: "", bankName: "" })); }}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5"
                              data-testid="button-clear-bank"
                            >
                              <X className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        </div>
                      </button>
                      {bankDropdownOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-gray-900 shadow-lg">
                          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                            <Search className="h-4 w-4 text-gray-400 shrink-0" />
                            <input
                              autoFocus
                              type="text"
                              value={bankSearch}
                              onChange={(e) => setBankSearch(e.target.value)}
                              placeholder="Buscar banco por nome ou código..."
                              className="w-full bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none"
                              data-testid="input-bank-search"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto py-1">
                            {BANKS.filter(b => {
                              const q = bankSearch.toLowerCase();
                              return !q || b.name.toLowerCase().includes(q) || b.code.includes(q);
                            }).map(bank => (
                              <button
                                key={bank.code}
                                type="button"
                                onClick={() => { handleBankSelect(bank.code); setBankDropdownOpen(false); setBankSearch(""); }}
                                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-[#f0f4ff]/20 transition-colors ${formData.bankCode === bank.code ? "bg-blue-50 dark:bg-[#f0f4ff]/30 text-[#2563eb] dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300"}`}
                                data-testid={`bank-option-${bank.code}`}
                              >
                                {bank.code} - {bank.name}
                              </button>
                            ))}
                            {BANKS.filter(b => { const q = bankSearch.toLowerCase(); return !q || b.name.toLowerCase().includes(q) || b.code.includes(q); }).length === 0 && (
                              <div className="px-3 py-4 text-sm text-gray-400 text-center">Nenhum banco encontrado</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="agency" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        Agência
                      </Label>
                      <Input
                        id="agency"
                        value={formData.agency}
                        onChange={(e) => updateField("agency", e.target.value)}
                        placeholder="0000"
                        className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                        data-testid="input-agency"
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountNumber" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        Número da Conta
                      </Label>
                      <Input
                        id="accountNumber"
                        value={formData.accountNumber}
                        onChange={(e) => updateField("accountNumber", e.target.value)}
                        placeholder="00000-0"
                        className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                        data-testid="input-account-number"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Tipo de Conta
                    </Label>
                    <Select value={formData.accountType} onValueChange={(v) => updateField("accountType", v)}>
                      <SelectTrigger className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20" data-testid="select-account-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="corrente">Conta Corrente</SelectItem>
                        <SelectItem value="poupanca">Conta Poupança</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Card: PIX */}
              <Card className="border border-gray-200 dark:border-lime-500/20 bg-white dark:bg-transparent">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-gray-500" />
                    Chave PIX
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Tipo da Chave PIX
                    </Label>
                    <Select value={formData.pixKeyType} onValueChange={(v) => updateField("pixKeyType", v)}>
                      <SelectTrigger className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20" data-testid="select-pix-key-type">
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cpf">CPF</SelectItem>
                        <SelectItem value="cnpj">CNPJ</SelectItem>
                        <SelectItem value="email">E-mail</SelectItem>
                        <SelectItem value="phone">Telefone</SelectItem>
                        <SelectItem value="random">Chave Aleatória</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="pixKey" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Chave PIX
                    </Label>
                    <Input
                      id="pixKey"
                      value={formData.pixKey}
                      onChange={(e) => updateField("pixKey", e.target.value)}
                      placeholder={
                        formData.pixKeyType === 'cpf' ? '000.000.000-00' :
                        formData.pixKeyType === 'cnpj' ? '00.000.000/0000-00' :
                        formData.pixKeyType === 'email' ? 'seuemail@email.com' :
                        formData.pixKeyType === 'phone' ? '+5511999999999' :
                        'Cole sua chave aleatória'
                      }
                      className="mt-1 bg-white dark:bg-transparent border-gray-200 dark:border-lime-500/20"
                      data-testid="input-pix-key"
                    />
                  </div>

                  <div className="p-3 bg-blue-50 dark:bg-[#f0f4ff]/20 border border-blue-200 dark:border-[#2563eb]/30 rounded-lg">
                    <p className="text-xs text-[#2563eb] dark:text-blue-400">
                      Sua chave PIX será usada automaticamente ao solicitar saques. Certifique-se de que está correta.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="w-full bg-[#2563eb] hover:bg-[#2563eb] text-white font-semibold py-5 shadow-lg"
              data-testid="button-save-banking"
            >
              {saveMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </span>
              ) : saved ? (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Salvo com sucesso!
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  Salvar Dados Bancários
                </span>
              )}
            </Button>

            {data?.bankingData?.updatedAt && (
              <p className="text-center text-xs text-gray-400">
                Última atualização: {new Date(data.bankingData.updatedAt).toLocaleString('pt-BR')}
              </p>
            )}
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
