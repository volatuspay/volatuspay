import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Loader2, Check, X, FileText } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

interface DocumentUploadProps {
  title: string;
  description: string;
  value: string;
  onUpload: (url: string) => void;
  sellerData?: {
    businessName?: string;
    document?: string;
    email?: string;
  };
  acceptPdfOnly?: boolean;
  acceptImagesOnly?: boolean;
}

function detectIsPdf(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('.pdf') || lower.includes('%2fpdf') || lower.includes('/pdf/');
}

export default function DocumentUpload({ title, description, value, onUpload, sellerData, acceptPdfOnly, acceptImagesOnly }: DocumentUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState(value);
  const [imgError, setImgError] = useState(false);
  const [uploadedAsPdf, setUploadedAsPdf] = useState(() => detectIsPdf(value));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  React.useEffect(() => {
    setPreviewImage(value);
    setImgError(false);
    setUploadedAsPdf(detectIsPdf(value));
  }, [value]);

  React.useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleFileUpload = async (file: File) => {
    if (isUploading) {
      toast({ title: "Upload em andamento", description: "Aguarde o upload atual terminar", variant: "destructive" });
      return;
    }

    let allowedTypes: string[];
    let errorMsg: string;

    if (acceptPdfOnly) {
      allowedTypes = ['application/pdf'];
      errorMsg = 'Use apenas PDF';
    } else if (acceptImagesOnly) {
      allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      errorMsg = 'Use apenas JPG ou PNG';
    } else {
      allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
      errorMsg = 'Use apenas JPG, PNG ou PDF';
    }

    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Tipo de arquivo não suportado", description: errorMsg, variant: "destructive" });
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Arquivo muito grande", description: "Tamanho máximo: 5MB.", variant: "destructive" });
      return;
    }

    const fileIsPdf = file.type === 'application/pdf';

    setIsUploading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    const timeoutId = setTimeout(() => {
      controller.abort();
      toast({ title: "Upload demorou muito", description: "Tente novamente.", variant: "destructive" });
    }, 30000);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      if (sellerData) {
        formData.append('businessName', sellerData.businessName || '');
        formData.append('document', sellerData.document || '');
        formData.append('email', sellerData.email || '');
      }

      const currentUser = auth.currentUser;
      const headers: HeadersInit = {};
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/upload/document', {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = 'Erro no upload';
        if (response.status === 400) errorMessage = 'Arquivo inválido';
        else if (response.status === 413) errorMessage = 'Arquivo muito grande (max 5MB)';
        else if (response.status === 429) errorMessage = 'Muitas tentativas. Aguarde.';
        else {
          try { const d = await response.json(); errorMessage = d.message || errorMessage; } catch {}
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (data.success && data.url) {
        setPreviewImage(data.url);
        setImgError(false);
        setUploadedAsPdf(fileIsPdf);
        onUpload(data.url);
        toast({ title: "Upload realizado!", description: "Documento salvo com sucesso" });
      } else {
        throw new Error('URL não retornada pelo servidor');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast({ title: "Erro no upload", description: error instanceof Error ? error.message : "Tente novamente", variant: "destructive" });
    } finally {
      clearTimeout(timeoutId);
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const clearDocument = () => {
    setPreviewImage("");
    setImgError(false);
    setUploadedAsPdf(false);
    onUpload("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isPdf = uploadedAsPdf || detectIsPdf(previewImage);

  let acceptAttr: string;
  if (acceptPdfOnly) {
    acceptAttr = 'application/pdf';
  } else if (acceptImagesOnly) {
    acceptAttr = 'image/jpeg,image/jpg,image/png';
  } else {
    acceptAttr = 'image/jpeg,image/jpg,image/png,application/pdf';
  }

  return (
    <div className={`rounded-md border px-3 py-2 transition-all ${value ? 'border-gray-300 bg-white' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {previewImage && isPdf ? (
            <a href={previewImage} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <div className="h-10 w-10 rounded border border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-0.5 hover:border-gray-400 transition-colors">
                <FileText className="w-4 h-4 text-gray-600" />
                <span className="text-[9px] text-gray-600 font-bold leading-none">PDF</span>
              </div>
            </a>
          ) : previewImage && !imgError ? (
            <img
              src={previewImage}
              alt={title}
              className="h-10 w-10 object-cover rounded border border-gray-200 shrink-0"
              onError={() => setImgError(true)}
              data-testid={`preview-${title.toLowerCase().replace(/\s+/g, '-')}`}
            />
          ) : value ? (
            <Check className="w-4 h-4 shrink-0 text-gray-900" />
          ) : (
            <Upload className="w-4 h-4 text-gray-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>

        <div className="shrink-0">
          {previewImage && !imgError ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-gray-600"
              onClick={clearDocument}
              data-testid={`button-clear-${title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <X className="w-3 h-3" />
            </Button>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }}
                accept={acceptAttr}
                className="hidden"
                data-testid={`input-file-${title.toLowerCase().replace(/\s+/g, '-')}`}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-xs"
                data-testid={`button-upload-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {isUploading ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Enviando...</>
                ) : (
                  <><Upload className="mr-1 h-3 w-3" /> Anexar</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
