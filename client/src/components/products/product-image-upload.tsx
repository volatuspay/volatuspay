import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Loader2, Check, X, Image } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { resolveImageUrl } from '@/lib/image-url';

interface ProductImageUploadProps {
  value: string;
  onUpload: (url: string) => void;
  productData?: {
    title?: string;
    tenantId?: string;
  };
}

export default function ProductImageUpload({ value, onUpload, productData }: ProductImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState(resolveImageUrl(value) || value);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setPreviewImage(resolveImageUrl(value) || value);
  }, [value]);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    
    try {

      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error(`Imagem muito grande. Tamanho máximo: 5MB. Tamanho atual: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      }

      //  VALIDAR TIPO
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Formato no permitido. Use apenas PNG, JPG ou WebP');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', 'products');

      // Obter token do Firebase Auth
      const { auth } = await import('@/lib/firebase');
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        throw new Error('Vocprecisa estar autenticado para fazer upload');
      }

      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.message || errorData.error || 'Erro no upload';
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (data.success && data.url) {
        const resolved = resolveImageUrl(data.url) || data.url;
        setPreviewImage(resolved);
        onUpload(resolved);
        
        toast({
          title: "Imagem do produto salva!",
          description: ` ${data.originalName} salva com sucesso`,
        });
      } else {
        throw new Error('URL no retornada');
      }
    } catch (error) {
      
      let errorMessage = "Erro desconhecido. Tente novamente.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Erro ao fazer upload da imagem",
        description: errorMessage,
        variant: "destructive",
        duration: 6000,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const clearImage = () => {
    setPreviewImage("");
    onUpload("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {previewImage ? (
        <div className="relative">
          <div className="w-full max-w-xs sm:max-w-sm">
            <img
              src={previewImage}
              alt="Preview do produto"
              className="w-full h-32 sm:h-40 object-cover rounded-lg border"
              loading="lazy"
              data-testid="preview-product-image"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 h-6 w-6 sm:h-8 sm:w-8 p-0"
              onClick={clearImage}
              data-testid="button-clear-product-image"
            >
              <X className="w-3 h-3 sm:w-4 sm:h-4" />
            </Button>
          </div>
          
          <Alert className="mt-2 sm:mt-3">
            <AlertDescription className="text-xs">
               Imagem salva com sucesso
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 md:p-8 hover:border-gray-400 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFileUpload(e.target.files[0]);
                }
              }}
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              data-testid="input-file-product-image"
            />
            
            <div className="text-center">
              <Image className="mx-auto h-10 w-10 sm:h-12 sm:w-12 md:h-16 md:w-16 text-gray-400" />
              <div className="mt-3 sm:mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="relative text-xs sm:text-sm h-9 sm:h-10"
                  data-testid="button-upload-product-image"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-1.5 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                      <span className="hidden sm:inline">Processando imagem...</span>
                      <span className="sm:hidden">Processando...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="mr-1.5 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                      <span className="hidden sm:inline">Anexar Imagem do Produto</span>
                      <span className="sm:hidden">Anexar Imagem</span>
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-gray-500">
                PNG ou JPG até 5MB<br className="hidden sm:inline"/>
                <span className="hidden sm:inline"> 1410x2250px ideal</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}