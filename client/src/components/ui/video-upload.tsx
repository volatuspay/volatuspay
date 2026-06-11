import { useState } from 'react';
import { Upload, X, Loader2, CheckCircle, AlertCircle, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';

interface VideoUploadProps {
  value?: string;
  onChange: (guid: string) => void;
  maxSizeMB?: number;
  className?: string;
  disabled?: boolean;
  label?: string;
  description?: string;
}

export function VideoUpload({
  value,
  onChange,
  maxSizeMB = 500,
  className,
  disabled = false,
  label = 'Upload de Vídeo',
  description = 'MP4, WebM ou MOV (máx. 500MB)',
}: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoGuid, setVideoGuid] = useState<string | null>(value || null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validação de tamanho
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      setError(`Vídeo muito grande (${fileSizeMB}MB). Máximo permitido: ${maxSizeMB}MB.`);
      return;
    }

    // Validação de tipo
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedTypes.includes(file.type)) {
      setError(`Formato não permitido (${file.type}). Use apenas MP4, WebM ou MOV.`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Você precisa estar logado para fazer upload');
      }

      // PASSO 1: Criar vídeo no Bunny Stream (gera GUID)
      console.log('🎬 [VIDEO-UPLOAD] Criando vídeo no Bunny Stream...');
      const createResponse = await fetch('/api/bunny/video/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: file.name,
        }),
      });

      if (!createResponse.ok) {
        let errorMessage = 'Erro ao criar vídeo no Bunny Stream';
        try {
          const errorData = await createResponse.json();
          errorMessage = errorData.error || errorMessage;
        } catch {}
        throw new Error(errorMessage);
      }

      const createData = await createResponse.json();
      const guid = createData.video.guid;
      const tusUploadUrl = createData.video.tusUploadUrl;
      const tusHeaders = createData.video.tusHeaders;

      console.log(`✅ [VIDEO-UPLOAD] Vídeo criado com GUID: ${guid}`);

      // PASSO 2: Upload TUS direto para Bunny.net (não passa pelo nosso servidor)
      console.log('🚀 [VIDEO-UPLOAD] Iniciando upload TUS...');

      // TUS Upload (Resumable Upload Protocol)
      const tusResponse = await fetch(tusUploadUrl, {
        method: 'PUT',
        headers: {
          'AccessKey': tusHeaders.AccessKey,
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      });

      if (!tusResponse.ok) {
        throw new Error('Erro ao fazer upload do vídeo. Tente novamente.');
      }

      console.log('✅ [VIDEO-UPLOAD] Upload TUS concluído!');

      // Salvar GUID e notificar componente pai
      setVideoGuid(guid);
      onChange(guid);
      setError(null);
      setUploadProgress(100);

    } catch (err: any) {
      const errorMessage = err.message || 'Erro desconhecido ao fazer upload';
      setError(errorMessage);
      setVideoGuid(null);
      console.error('❌ [VIDEO-UPLOAD] Erro:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setVideoGuid(null);
    setUploadProgress(0);
    onChange('');
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}

      <Card className={cn(
        'relative overflow-hidden transition-all p-6',
        disabled && 'opacity-60 cursor-not-allowed'
      )}>
        {!videoGuid ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center gap-3 py-8">
              <div className="rounded-full bg-primary/10 p-4">
                <Video className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">
                  {uploading ? 'Fazendo upload...' : 'Faça upload do vídeo'}
                </p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              
              {!uploading && (
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => document.getElementById('video-upload-input')?.click()}
                    className="w-full"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Selecionar vídeo
                  </Button>
                  <input
                    id="video-upload-input"
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={disabled}
                  />
                </div>
              )}

              {uploading && (
                <div className="w-full max-w-xs space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Processando vídeo...</span>
                  </div>
                  {uploadProgress > 0 && (
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-100 dark:bg-gray-700 p-2">
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Vídeo carregado com sucesso</p>
                <p className="text-xs text-muted-foreground">GUID: {videoGuid}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleRemove}
              disabled={disabled}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
