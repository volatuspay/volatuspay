import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Upload, CheckCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getAuth } from 'firebase/auth';
import { ACQUIRER_CONFIG, AcquirerConfigProps } from "./types";

export function KeysSection({
  efibank,
  setEfibank,
  stripe,
  setStripe,
  adyen,
  setAdyen,
  woovi,
  setWoovi,
  pagarme,
  setPagarme,
  onz,
  setOnz,
  defaultAcquirers,
  setDefaultAcquirers,
  onSaveConfig,
}: AcquirerConfigProps) {
  const { toast } = useToast();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [uploadingCert, setUploadingCert] = useState(false);
  const [certUploaded, setCertUploaded] = useState(false);
  const [savingOnz, setSavingOnz] = useState(false);

  const toggleKeyVisibility = (fieldId: string) => {
    setShowKeys(prev => ({ ...prev, [fieldId]: !prev[fieldId] }));
  };

  const acquirerStates: Record<string, any> = {
    efibank,
    stripe,
    adyen,
    woovi,
    pagarme,
    onz,
  };

  const acquirerSetters: Record<string, any> = {
    efibank: setEfibank,
    stripe: setStripe,
    adyen: setAdyen,
    woovi: setWoovi,
    pagarme: setPagarme,
    onz: setOnz,
  };

  const handleSaveOnzCredentials = async () => {
    setSavingOnz(true);
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Não autenticado');

      const resp = await fetch('/api/admin/onz/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          cashInClientId:      onz?.cashInClientId || '',
          cashInClientSecret:  onz?.cashInClientSecret || '',
          cashOutClientId:     onz?.cashOutClientId || '',
          cashOutClientSecret: onz?.cashOutClientSecret || '',
          pixKey:              onz?.pixKey || '',
          environment:         onz?.environment || 'production',
          enabled:             onz?.enabled !== false,
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Erro ao salvar');

      toast({ title: '✅ ONZ Finance salvo!', description: 'Credenciais salvas eternamente no RTDB' });
    } catch (err: any) {
      toast({ title: '❌ Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSavingOnz(false);
    }
  };

  const handleFieldChange = (acquirerId: string, fieldKey: string, value: string) => {
    const setter = acquirerSetters[acquirerId];
    if (setter) {
      setter((prev: any) => ({
        ...prev,
        [fieldKey]: value
      }));
    }
  };

  const handleToggleEnabled = (acquirerId: string) => {
    const setter = acquirerSetters[acquirerId];
    const currentState = acquirerStates[acquirerId];
    if (setter) {
      setter({
        ...currentState,
        enabled: !currentState?.enabled
      });
    }
  };

  const isDefaultFor = (acquirerId: string): string[] => {
    if (!defaultAcquirers) return [];
    const methods: string[] = [];
    
    if (defaultAcquirers.pix === acquirerId) methods.push('PIX');
    if (defaultAcquirers.creditCardBR === acquirerId) methods.push('Cartão BR');
    if (defaultAcquirers.creditCardGlobal === acquirerId) methods.push('Cartão Global');
    if (defaultAcquirers.boleto === acquirerId) methods.push('Boleto');
    
    return methods;
  };

  const handleCertificateUpload = async (acquirerId: string, file: File) => {
    console.log('📤 [FRONTEND] handleCertificateUpload chamado!', { acquirerId, fileName: file.name, fileSize: file.size });
    
    if (acquirerId !== 'efibank') {
      console.log('⚠️ [FRONTEND] Ignorando upload - não é EfíBank');
      return;
    }
    
    setUploadingCert(true);
    setCertUploaded(false);
    
    try {
      console.log('🔑 [FRONTEND] Buscando token Firebase...');
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        throw new Error('Usuário não autenticado');
      }
      
      console.log('✅ [FRONTEND] Token obtido! Criando FormData...');
      const formData = new FormData();
      formData.append('certificate', file);
      
      console.log('🚀 [FRONTEND] Enviando para /api/admin/efibank/certificate...');
      const response = await fetch('/api/admin/efibank/certificate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      console.log('📥 [FRONTEND] Resposta recebida:', { status: response.status, ok: response.ok });
      const data = await response.json();
      console.log('📋 [FRONTEND] Dados da resposta:', data);
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.details || 'Erro ao fazer upload');
      }
      
      setCertUploaded(true);
      toast({
        title: "✅ Certificado salvo!",
        description: `Certificado EfíBank salvo no Firebase Storage: ${data.certificateStoragePath}`,
        variant: "default"
      });
      
      // Atualizar estado com caminho do Storage
      setEfibank((prev: any) => ({
        ...prev,
        certificateStoragePath: data.certificateStoragePath,
        certificateUpdatedAt: data.uploadedAt
      }));
      
      console.log('✅ [FRONTEND] Upload concluído com sucesso!');
      
    } catch (error: any) {
      console.error('❌ [FRONTEND] Erro ao fazer upload do certificado:', error);
      toast({
        title: "❌ Erro no upload",
        description: error.message || 'Não foi possível salvar o certificado',
        variant: "destructive"
      });
    } finally {
      setUploadingCert(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Configurar Chaves das Adquirentes</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure as credenciais de cada processador de pagamento. Depois escolha qual usar nas abas PIX, Cartão BR, Cartão Global e Boleto.
        </p>
      </div>

      {Object.entries(ACQUIRER_CONFIG).map(([acquirerId, config]) => {
        const state = acquirerStates[acquirerId];
        const isEnabled = state?.enabled ?? false;

        return (
          <Card 
            key={acquirerId}
            className="bg-white dark:bg-transparent"
            data-testid={`acquirer-card-${acquirerId}`}
          >
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <div>
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      {config.name}
                      {isDefaultFor(acquirerId).length > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-gray-700/70 text-emerald-700 dark:text-blue-400 rounded-full font-medium">
                          Padrão: {isDefaultFor(acquirerId).join(', ')}
                        </span>
                      )}
                    </CardTitle>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${isEnabled ? 'text-emerald-600 dark:text-emerald-500' : 'text-gray-500'}`}>
                    {isEnabled ? 'Ativo' : 'Inativo'}
                  </span>
                  <Switch
                    id={`${acquirerId}-enabled`}
                    checked={isEnabled}
                    onCheckedChange={() => handleToggleEnabled(acquirerId)}
                    data-testid={`switch-${acquirerId}-enabled`}
                  />
                </div>
              </div>
            </CardHeader>

            {isEnabled && (
              <CardContent className="pt-0 space-y-3 border-t border-gray-100 dark:border-gray-800">
                {config.fields.map((field) => {
                  const fieldId = `${acquirerId}-${field.key}`;
                  const isPasswordType = field.type === 'password';
                  const isFileType = field.type === 'file';
                  const shouldShowKey = showKeys[fieldId];
                  const fieldValue = state?.[field.key] || '';

                  // 📤 CAMPO DE UPLOAD DE ARQUIVO
                  if (isFileType) {
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <Label htmlFor={fieldId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </Label>
                        
                        <div className="flex gap-2">
                          <Input
                            id={fieldId}
                            type="file"
                            accept=".p12,.pfx"
                            onChange={(e) => {
                              console.log('📁 [FRONTEND] onChange disparado no input file!', { 
                                acquirerId, 
                                filesLength: e.target.files?.length 
                              });
                              const file = e.target.files?.[0];
                              if (file) {
                                console.log('✅ [FRONTEND] Arquivo selecionado:', { 
                                  name: file.name, 
                                  size: file.size, 
                                  type: file.type 
                                });
                                handleCertificateUpload(acquirerId, file);
                              } else {
                                console.warn('⚠️ [FRONTEND] Nenhum arquivo foi selecionado!');
                              }
                            }}
                            disabled={uploadingCert}
                            className="flex-1 bg-white dark:bg-gray-700"
                            data-testid={`input-${acquirerId}-${field.key}`}
                          />
                          
                          {uploadingCert && (
                            <Button variant="outline" size="icon" disabled>
                              <Upload className="w-4 h-4 animate-spin" />
                            </Button>
                          )}
                          
                          {certUploaded && !uploadingCert && (
                            <Button variant="outline" size="icon" className="text-emerald-600">
                              <CheckCircle className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        
                        {state?.certificateStoragePath && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-500">
                            ✓ Certificado salvo no Firebase Storage (eterno)
                          </p>
                        )}
                      </div>
                    );
                  }

                  // 📝 CAMPO NORMAL (text, password, etc)
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={fieldId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </Label>
                      
                      <div className="flex gap-2">
                        <Input
                          id={fieldId}
                          type={isPasswordType && !shouldShowKey ? 'password' : 'text'}
                          value={fieldValue}
                          onChange={(e) => handleFieldChange(acquirerId, field.key, e.target.value)}
                          placeholder={`Digite ${field.label.toLowerCase()}`}
                          className="flex-1 bg-white dark:bg-gray-700"
                          data-testid={`input-${acquirerId}-${field.key}`}
                        />
                        
                        {isPasswordType && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => toggleKeyVisibility(fieldId)}
                            data-testid={`toggle-${acquirerId}-${field.key}`}
                          >
                            {shouldShowKey ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Botão especial para salvar ONZ Finance no RTDB */}
                {acquirerId === 'onz' && (
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveOnzCredentials}
                      disabled={savingOnz}
                      className="bg-violet-600 hover:bg-violet-700 text-white"
                      data-testid="btn-save-onz-credentials"
                    >
                      {savingOnz ? 'Salvando...' : '🏦 Salvar ONZ Finance no RTDB (Eterno)'}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      Salva as credenciais diretamente no Firebase RTDB para uso permanente
                    </p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
