import { useState, useRef, useEffect } from 'react';
import { Upload, X, Loader2, CheckCircle, AlertCircle, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';
import { resolveImageUrl } from '@/lib/image-url';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  category?: 'products' | 'testimonials' | 'lessons' | 'modules' | 'banners' | 'showcases';
  maxSizeMB?: number;
  accept?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  aspectRatio?: 'auto' | '1:1' | '16:9' | '4:3'; // 🎨 Controle de proporção
  fitMode?: 'cover' | 'contain'; // 🖼️ Modo de ajuste da imagem
  requiredDimensions?: { width: number; height: number }; // 📐 Dimensões exatas obrigatórias
  requiredAspectRatio?: { ratio: number; tolerance?: number }; // 📐 Proporção obrigatória (ex: 2/3, tolerância padrão 0.02)
}

export function ImageUpload({
  value,
  onChange,
  category = 'products',
  maxSizeMB = 5,
  accept = 'image/jpeg,image/jpg,image/png,image/webp',
  className,
  disabled = false,
  label = 'Upload de Imagem',
  description = 'PNG, JPG ou WebP (máx. 5MB)',
  aspectRatio = 'auto', // 🎨 Padrão: altura automática
  fitMode = 'cover', // 🖼️ Padrão: cobre toda área
  requiredDimensions, // 📐 Dimensões exatas obrigatórias
  requiredAspectRatio // 📐 Proporção obrigatória
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(resolveImageUrl(value) || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value !== undefined) {
      setPreview(resolveImageUrl(value) || null);
    }
  }, [value]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validao de tamanho
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      setError(`Imagem muito grande (${fileSizeMB}MB). Máximo permitido: ${maxSizeMB}MB. Reduza o tamanho da imagem e tente novamente.`);
      return;
    }

    // Validao de tipo
    const allowedTypes = accept.split(',').map(t => t.trim());
    if (!allowedTypes.includes(file.type)) {
      setError(`Formato não permitido (${file.type}). Use apenas PNG, JPG ou WebP.`);
      return;
    }

    // Função auxiliar para fazer upload
    const performUpload = async () => {
      setUploading(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          throw new Error('Você precisa estar logado para fazer upload');
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', category);

        const uploadEndpoint = '/api/upload/image';

        console.log(`🚀 Iniciando upload (Bunny CDN + Firebase Backup):`, { 
          fileName: file.name, 
          size: file.size, 
          type: file.type,
          category,
          endpoint: uploadEndpoint
        });

        const response = await fetch(uploadEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        console.log('Resposta do servidor:', response.status, response.statusText);

        if (!response.ok) {
          let errorMessage = 'Erro ao fazer upload da imagem';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (jsonErr) {
            if (response.status === 401) errorMessage = 'Sessão expirada. Faça login novamente.';
            else if (response.status === 413) errorMessage = 'Imagem muito grande. Tente uma menor.';
            else if (response.status === 429) errorMessage = 'Limite de uploads excedido. Aguarde um momento.';
            else if (response.status === 500) errorMessage = 'Erro no servidor. Tente novamente.';
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        
        if (!data.url) {
          throw new Error('Servidor não retornou URL da imagem');
        }

        const resolvedUrl = resolveImageUrl(data.url) || data.url;
        console.log(`✅ Upload concluído (${data.storage || 'bunny-cdn'}):`, resolvedUrl);
        onChange(resolvedUrl);
        setError(null);
      } catch (err: any) {
        const errorMessage = err.message || err.name || 'Erro desconhecido ao fazer upload';
        setError(errorMessage);
        setPreview(null);
        console.error('Erro no upload:', {
          message: err.message,
          name: err.name,
          stack: err.stack,
          fullError: err
        });
      } finally {
        setUploading(false);
      }
    };

    // Validação de proporção (aspect ratio) - se requiredAspectRatio fornecido
    if (requiredAspectRatio) {
      const img = new Image();
      img.onload = async () => {
        const imageRatio = img.width / img.height;
        const tolerance = requiredAspectRatio.tolerance || 0.02; // Tolerância padrão 2%
        const expectedRatio = requiredAspectRatio.ratio;
        
        // Verificar se está dentro da tolerância
        if (Math.abs(imageRatio - expectedRatio) > tolerance) {
          setError(
            `⚠️ Proporção incorreta! Esperado: ${expectedRatio.toFixed(2)} (${img.width}x${img.height} = ${imageRatio.toFixed(2)}). ` +
            `Por favor, use uma imagem com proporção correta (ex: 1000x1500, 1200x1800 para 2:3).`
          );
          setPreview(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }
        
        // Proporção correta - criar preview E fazer upload
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
        
        // Fazer upload após validação bem-sucedida
        await performUpload();
      };
      img.onerror = () => {
        setError('Erro ao validar proporção da imagem. Tente outra imagem.');
        return;
      };
      img.src = URL.createObjectURL(file);
      return; // Parar aqui para aguardar validação assíncrona
    }

    // Validação de dimensões exatas (se requiredDimensions fornecido)
    if (requiredDimensions) {
      const img = new Image();
      img.onload = async () => {
        if (img.width !== requiredDimensions.width || img.height !== requiredDimensions.height) {
          setError(
            `⚠️ A imagem deve ter EXATAMENTE ${requiredDimensions.width}x${requiredDimensions.height} pixels (proporção 2:3). ` +
            `A sua imagem tem ${img.width}x${img.height}px. Redimensione e tente novamente.`
          );
          setPreview(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }
        // Dimensões corretas - criar preview E fazer upload
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
        
        // Fazer upload após validação bem-sucedida
        await performUpload();
      };
      img.onerror = () => {
        setError('Erro ao validar dimensões da imagem. Tente outra imagem.');
        return;
      };
      img.src = URL.createObjectURL(file);
      return; // Parar aqui para aguardar validação assíncrona
    }

    // Criar preview local (se não há requiredDimensions)
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload para servidor (se não há requiredDimensions)
    performUpload();
  };

  const handleRemove = () => {
    setPreview(null);
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      
      <Card className={cn(
        'relative overflow-hidden transition-all',
        preview ? 'p-0' : 'p-6',
        disabled && 'opacity-60 cursor-not-allowed'
      )}>
        {!preview ? (
          <div
            onClick={!disabled ? handleClick : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-lg border-2 border-dashed py-8',
              disabled && 'cursor-not-allowed'
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Fazendo upload...</p>
              </>
            ) : (
              <>
                <div className="p-3 rounded-full bg-primary/10">
                  <ImageIcon className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">
                    Clique para selecionar uma imagem
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {description}
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="relative group">
            <div className={cn(
              'w-full overflow-hidden',
              aspectRatio === '1:1' && 'aspect-square',
              aspectRatio === '16:9' && 'aspect-video',
              aspectRatio === '4:3' && 'aspect-[4/3]',
              aspectRatio === 'auto' && 'h-48'
            )}>
              <img
                src={preview}
                alt="Preview"
                className={cn(
                  'w-full h-full',
                  fitMode === 'cover' ? 'object-cover' : 'object-contain'
                )}
              />
            </div>
            {!disabled && (
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClick}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Trocar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleRemove}
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                  Remover
                </Button>
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileSelect}
          disabled={disabled || uploading}
          className="hidden"
        />
      </Card>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {preview && !uploading && !error && (
        <div className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle className="h-4 w-4" />
          <span>Imagem carregada com sucesso</span>
        </div>
      )}
    </div>
  );
}
