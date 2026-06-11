import { createContext, useContext, useState, ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';

type DialogType = 'alert' | 'confirm' | 'prompt';
type DialogVariant = 'info' | 'success' | 'warning' | 'error';

interface DialogConfig {
  type: DialogType;
  variant?: DialogVariant;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm?: (value?: string) => void;
  onCancel?: () => void;
}

interface CustomDialogContextType {
  showAlert: (message: string, title?: string, variant?: DialogVariant) => Promise<void>;
  showConfirm: (message: string, title?: string, variant?: DialogVariant) => Promise<boolean>;
  showPrompt: (message: string, defaultValue?: string, placeholder?: string) => Promise<string | null>;
}

const CustomDialogContext = createContext<CustomDialogContextType | undefined>(undefined);

export function CustomDialogProvider({ children }: { children: ReactNode }) {
  const [dialogConfig, setDialogConfig] = useState<DialogConfig | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const getIcon = (variant: DialogVariant = 'info') => {
    switch (variant) {
      case 'success':
        return <CheckCircle className="h-6 w-6 text-emerald-500" />;
      case 'warning':
        return <AlertCircle className="h-6 w-6 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-red-500" />;
      default:
        return <Info className="h-6 w-6 text-blue-500" />;
    }
  };

  const showAlert = (message: string, title?: string, variant: DialogVariant = 'info'): Promise<void> => {
    return new Promise((resolve) => {
      setDialogConfig({
        type: 'alert',
        variant,
        title,
        message,
        confirmText: 'OK',
        onConfirm: () => {
          setDialogConfig(null);
          resolve();
        },
      });
    });
  };

  const showConfirm = (message: string, title?: string, variant: DialogVariant = 'warning'): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogConfig({
        type: 'confirm',
        variant,
        title,
        message,
        confirmText: 'OK',
        cancelText: 'Cancelar',
        onConfirm: () => {
          setDialogConfig(null);
          resolve(true);
        },
        onCancel: () => {
          setDialogConfig(null);
          resolve(false);
        },
      });
    });
  };

  const showPrompt = (message: string, defaultValue = '', placeholder = ''): Promise<string | null> => {
    setPromptValue(defaultValue);
    return new Promise((resolve) => {
      setDialogConfig({
        type: 'prompt',
        variant: 'info',
        message,
        placeholder,
        defaultValue,
        confirmText: 'OK',
        cancelText: 'Cancelar',
        onConfirm: (value?: string) => {
          setDialogConfig(null);
          setPromptValue('');
          resolve(value || '');
        },
        onCancel: () => {
          setDialogConfig(null);
          setPromptValue('');
          resolve(null);
        },
      });
    });
  };

  return (
    <CustomDialogContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}
      
      <AlertDialog open={!!dialogConfig} onOpenChange={(open) => !open && dialogConfig?.onCancel?.()}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              {dialogConfig?.variant && getIcon(dialogConfig.variant)}
              <div className="flex-1">
                <AlertDialogTitle className="text-left">
                  {dialogConfig?.title || 'Confirmação'}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-left whitespace-pre-wrap mt-2">
                  {dialogConfig?.message}
                </AlertDialogDescription>
                
                {dialogConfig?.type === 'prompt' && (
                  <Input
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    placeholder={dialogConfig.placeholder}
                    className="mt-4"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        dialogConfig.onConfirm?.(promptValue);
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {dialogConfig?.type !== 'alert' && (
              <AlertDialogCancel onClick={dialogConfig?.onCancel}>
                {dialogConfig?.cancelText || 'Cancelar'}
              </AlertDialogCancel>
            )}
            <AlertDialogAction onClick={() => dialogConfig?.onConfirm?.(promptValue)}>
              {dialogConfig?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomDialogContext.Provider>
  );
}

export function useCustomDialog() {
  const context = useContext(CustomDialogContext);
  if (!context) {
    throw new Error('useCustomDialog must be used within CustomDialogProvider');
  }
  return context;
}
