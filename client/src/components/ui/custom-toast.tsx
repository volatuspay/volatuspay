import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Info, 
  X 
} from 'lucide-react';

export interface CustomToastProps {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  description?: string;
  duration?: number;
  onClose: (id: string) => void;
}

const CustomToast: React.FC<CustomToastProps> = ({
  id,
  type,
  title,
  description,
  duration = 5000,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Auto close after duration
    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const handleClose = () => {
    setIsAnimating(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose(id);
    }, 300);
  };

  const getConfig = () => {
    switch (type) {
      case 'success':
        return {
          icon: CheckCircle,
          bgColor: 'bg-emerald-50 dark:bg-gray-700',
          borderColor: 'border-emerald-200 dark:border-[#f0f4ff]',
          iconColor: 'text-emerald-600 dark:text-blue-400',
          titleColor: 'text-[#f0f4ff] dark:text-emerald-200'
        };
      case 'error':
        return {
          icon: XCircle,
          bgColor: 'bg-red-50 dark:bg-red-900/20',
          borderColor: 'border-red-200 dark:border-red-800',
          iconColor: 'text-red-600 dark:text-red-400',
          titleColor: 'text-red-800 dark:text-red-200'
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
          borderColor: 'border-yellow-200 dark:border-yellow-800',
          iconColor: 'text-yellow-600 dark:text-yellow-400',
          titleColor: 'text-yellow-800 dark:text-yellow-200'
        };
      case 'info':
        return {
          icon: Info,
          bgColor: 'bg-blue-50 dark:bg-blue-900/20',
          borderColor: 'border-blue-200 dark:border-blue-800',
          iconColor: 'text-blue-600 dark:text-blue-400',
          titleColor: 'text-blue-800 dark:text-blue-200'
        };
    }
  };

  if (!isVisible) return null;

  const config = getConfig();
  const Icon = config.icon;

  return (
    <Card 
      className={`
        ${config.bgColor} ${config.borderColor}
        transition-all duration-300 ease-in-out
        ${isAnimating ? 'opacity-0 transform translate-x-full' : 'opacity-100 transform translate-x-0'}
        shadow-lg hover:shadow-xl
        min-w-[320px] max-w-[500px]
      `}
      data-testid={`custom-toast-${type}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start space-x-3">
          <Icon className={`h-5 w-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />
          <div className="flex-1">
            <h4 className={`text-sm font-semibold ${config.titleColor}`}>
              {title}
            </h4>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-6 w-6 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
            data-testid={`close-toast-${id}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CustomToast;