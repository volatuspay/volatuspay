import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Video, 
  Camera, 
  Loader2, 
  Check, 
  X, 
  RotateCcw,
  Shield,
  Eye,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { Progress } from '@/components/ui/progress';

interface FacialVerificationProps {
  value: string;
  onVerification: (videoUrl: string) => void;
  sellerData?: {
    name?: string;
    document?: string;
    email?: string;
  };
}

type RecordingState = 'idle' | 'permission' | 'ready' | 'countdown' | 'recording' | 'processing' | 'preview' | 'uploading' | 'completed' | 'error';

const RECORDING_DURATION = 5000;
const COUNTDOWN_SECONDS = 3;

export default function FacialVerification({ value, onVerification, sellerData }: FacialVerificationProps) {
  const [state, setState] = useState<RecordingState>(value ? 'completed' : 'idle');
  const [consentGiven, setConsentGiven] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(value || '');
  const [errorMessage, setErrorMessage] = useState('');
  const [currentInstruction, setCurrentInstruction] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const instructions = [
    { text: 'Olhe para a câmera', icon: Eye },
    { text: 'Pisque os olhos lentamente', icon: Eye },
    { text: 'Vire levemente para a direita', icon: RotateCcw },
    { text: 'Vire levemente para a esquerda', icon: RotateCcw },
    { text: 'Olhe para a câmera novamente', icon: Eye },
  ];

  useEffect(() => {
    if (value) {
      setPreviewUrl(value);
      setState('completed');
    }
  }, [value]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if ((state === 'ready' || state === 'countdown' || state === 'recording') && streamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(err => {
          console.warn('Erro ao reproduzir vídeo:', err);
        });
      }
    }
  }, [state]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const isInIframe = (): boolean => {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  };

  const isSecureContext = (): boolean => {
    return window.isSecureContext || 
           window.location.protocol === 'https:' || 
           window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1';
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  const setupPermissionListener = async () => {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permissionStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        
        permissionStatus.onchange = () => {
          console.log('[FacialVerification] Permissão alterada para:', permissionStatus.state);
          if (permissionStatus.state === 'granted' && (state === 'error' || state === 'idle')) {
            requestCameraPermission();
          }
        };
      }
    } catch (e) {
      console.log('[FacialVerification] Listener de permissão não suportado');
    }
  };

  useEffect(() => {
    setupPermissionListener();
  }, []);

  const requestCameraPermission = async () => {
    console.log('[FacialVerification] Iniciando...');
    
    const inIframe = isInIframe();
    const secure = isSecureContext();
    
    console.log('[FacialVerification] Iframe:', inIframe, 'Secure:', secure);

    if (inIframe) {
      console.log('[FacialVerification] Bloqueado por iframe');
      setState('error');
      setErrorMessage('IFRAME_BLOCKED');
      return;
    }

    if (!secure) {
      console.log('[FacialVerification] Contexto não seguro');
      setState('error');
      setErrorMessage('Conexão não segura. Acesse via HTTPS.');
      return;
    }

    setState('permission');
    setErrorMessage('');

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MediaDevicesNotSupported');
      }

      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640, min: 320 },
          height: { ideal: 480, min: 240 }
        },
        audio: false
      };

      let stream: MediaStream;
      
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstError: any) {
        console.warn('[FacialVerification] Tentando simples:', firstError?.name);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      console.log('[FacialVerification] Câmera OK!');
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playError) {
          console.warn('[FacialVerification] Autoplay bloqueado');
        }
      }

      setState('ready');
      
    } catch (error: any) {
      console.error('[FacialVerification] Erro:', error?.name);
      setState('error');
      
      const errorName = error?.name || error?.message || 'Unknown';
      
      if (errorName === 'MediaDevicesNotSupported') {
        setErrorMessage('Navegador incompatível. Use Chrome, Firefox ou Safari.');
      } else if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setErrorMessage('PERMISSION_DENIED');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setErrorMessage('Nenhuma câmera detectada.');
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        setErrorMessage('Câmera em uso por outro app.');
      } else {
        setErrorMessage(`Erro: ${errorName}`);
      }
    }
  };

  const startCountdown = () => {
    setState('countdown');
    setCountdown(COUNTDOWN_SECONDS);
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          startRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startRecording = () => {
    if (!streamRef.current) return;

    setState('recording');
    setRecordingProgress(0);
    setCurrentInstruction(0);
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4';

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 1000000
    });

    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setState('preview');
      stopCamera();
    };

    mediaRecorder.start(100);

    const progressInterval = setInterval(() => {
      setRecordingProgress(prev => {
        const newProgress = prev + (100 / (RECORDING_DURATION / 100));
        return Math.min(newProgress, 100);
      });
    }, 100);

    const instructionInterval = setInterval(() => {
      setCurrentInstruction(prev => (prev + 1) % instructions.length);
    }, RECORDING_DURATION / instructions.length);

    setTimeout(() => {
      clearInterval(progressInterval);
      clearInterval(instructionInterval);
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, RECORDING_DURATION);
  };

  const retryRecording = () => {
    setRecordedBlob(null);
    if (previewUrl && !value) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setState('idle');
    setConsentGiven(false);
  };

  const uploadVideo = async () => {
    if (!recordedBlob) {
      toast({
        title: "Erro",
        description: "Nenhum vídeo gravado para enviar",
        variant: "destructive",
      });
      return;
    }

    setState('uploading');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = setTimeout(() => {
      controller.abort();
      toast({
        title: "Upload demorou muito",
        description: "O servidor não respondeu em 60 segundos. Tente novamente.",
        variant: "destructive",
      });
    }, 60000);

    try {
      const formData = new FormData();
      
      const fileName = `facial-verification-${Date.now()}.webm`;
      const videoFile = new File([recordedBlob], fileName, { type: recordedBlob.type });
      formData.append('file', videoFile);
      formData.append('type', 'facial-verification');
      
      if (sellerData) {
        formData.append('businessName', sellerData.name || '');
        formData.append('document', sellerData.document || '');
        formData.append('email', sellerData.email || '');
      }

      const headers: HeadersInit = {};
      const currentUser = auth.currentUser;
      
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/upload/facial-verification', {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = 'Erro no upload';
        
        if (response.status === 400) {
          errorMessage = 'Vídeo inválido';
        } else if (response.status === 413) {
          errorMessage = 'Vídeo muito grande';
        } else if (response.status === 429) {
          errorMessage = 'Muitas tentativas. Aguarde alguns minutos';
        } else {
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage;
          } catch {
            errorMessage = `Erro ${response.status}: ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      setState('completed');
      onVerification(data.url);
      
      toast({
        title: "Verificação facial concluída!",
        description: "Seu vídeo foi enviado com sucesso.",
      });

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Upload cancelado por timeout');
        setState('preview');
        return;
      }
      
      console.error('Erro no upload:', error);
      setState('preview');
      toast({
        title: "Erro no upload",
        description: error instanceof Error ? error.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      clearTimeout(timeoutId);
      abortControllerRef.current = null;
    }
  };

  const removeVerification = () => {
    // Parar qualquer stream de câmera ativa
    stopCamera();
    
    // Revogar URL blob anterior (se existir e não for URL do servidor)
    if (previewUrl && !previewUrl.startsWith('http')) {
      URL.revokeObjectURL(previewUrl);
    }
    
    // Resetar todos os estados
    setPreviewUrl('');
    setRecordedBlob(null);
    setState('idle');
    setConsentGiven(false);
    setErrorMessage('');
    setCountdown(COUNTDOWN_SECONDS);
    setRecordingProgress(0);
    setCurrentInstruction(0);
    chunksRef.current = [];
    
    // Notificar o componente pai
    onVerification('');
  };

  const CurrentIcon = instructions[currentInstruction]?.icon || Eye;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-900">Verificação Facial (KYC)</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">Grave um vídeo de 5 segundos do seu rosto</p>
      <div>
        {state === 'completed' && previewUrl ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-blue-600">
              <Check className="h-5 w-5" />
              <span className="font-medium">Verificação facial concluída!</span>
            </div>
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden max-w-sm mx-auto">
              <video
                src={previewUrl}
                className="w-full h-full object-cover"
                controls
                playsInline
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={removeVerification}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              Refazer verificação
            </Button>
          </div>
        ) : state === 'error' ? (
          <div className="space-y-3">
            {errorMessage === 'IFRAME_BLOCKED' ? (
              <>
                <Alert className="bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-orange-800 dark:text-orange-200">
                    <strong>Câmera bloqueada pelo navegador.</strong>
                    <br />
                    Para usar a câmera, abra esta página em uma nova aba.
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  onClick={openInNewTab}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir em Nova Aba
                </Button>
              </>
            ) : errorMessage === 'PERMISSION_DENIED' ? (
              <>
                <Alert className="bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-[#f0f4ff]">
                  <Camera className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-[#f0f4ff] dark:text-emerald-200">
                    <strong>Permissão da câmera necessária</strong>
                    <br />
                    <span className="text-sm">
                      1. Clique no ícone ao lado da URL (cadeado ou câmera)
                      <br />
                      2. Encontre "Câmera" e mude para "Permitir"
                      <br />
                      3. Clique no botão abaixo para tentar novamente
                    </span>
                  </AlertDescription>
                </Alert>
                <Button
                  type="button"
                  onClick={requestCameraPermission}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Tentar Novamente
                </Button>
              </>
            ) : (
              <>
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
                <Button
                  type="button"
                  onClick={requestCameraPermission}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Tentar novamente
                </Button>
              </>
            )}
          </div>
        ) : state === 'idle' ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-gray-500" />
                Por que precisamos desta verificação?
              </h4>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>• Garantir que você é uma pessoa real</li>
                <li>• Prevenir fraudes e contas falsas</li>
                <li>• Proteger sua identidade e nossos clientes</li>
                <li>• Cumprir regulamentações de segurança financeira</li>
              </ul>
            </div>

            <div className="flex items-start space-x-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <Checkbox
                id="facial-consent"
                checked={consentGiven}
                onCheckedChange={(checked) => setConsentGiven(checked === true)}
              />
              <label htmlFor="facial-consent" className="text-sm leading-tight cursor-pointer">
                <span className="font-medium text-gray-900">Autorizo a gravação do meu rosto</span>
                <p className="text-gray-500 mt-1">
                  Concordo com a gravação de vídeo facial para fins de verificação de identidade, 
                  conforme a Lei Geral de Proteção de Dados (LGPD). O vídeo será armazenado de forma 
                  segura e utilizado apenas para validação cadastral.
                </p>
              </label>
            </div>

            <Button
              type="button"
              onClick={requestCameraPermission}
              disabled={!consentGiven}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white"
            >
              <Camera className="h-4 w-4 mr-2" />
              Iniciar Verificação Facial
            </Button>
          </div>
        ) : state === 'permission' ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            <p className="text-gray-500">Aguardando permissão da câmera...</p>
          </div>
        ) : state === 'ready' ? (
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden max-w-sm mx-auto">
              <video
                ref={videoRef}
                className="w-full h-full object-cover mirror"
                autoPlay
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="absolute bottom-2 left-2 right-2 bg-black/50 text-white text-xs p-2 rounded">
                Posicione seu rosto no centro da tela
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopCamera();
                  setState('idle');
                }}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={startCountdown}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white"
              >
                <Video className="h-4 w-4 mr-2" />
                Iniciar Gravação
              </Button>
            </div>
          </div>
        ) : state === 'countdown' ? (
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden max-w-sm mx-auto">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="text-6xl font-bold text-white animate-pulse">
                  {countdown}
                </div>
              </div>
            </div>
            <p className="text-center text-muted-foreground">
              Prepare-se! A gravação começará em {countdown}...
            </p>
          </div>
        ) : state === 'recording' ? (
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden max-w-sm mx-auto">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
              <div className="absolute top-2 left-2 flex items-center gap-2 bg-red-600 text-white text-xs px-2 py-1 rounded">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                GRAVANDO
              </div>
              <div className="absolute bottom-2 left-2 right-2 bg-black/70 text-white p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <CurrentIcon className="h-5 w-5" />
                  <span className="font-medium">{instructions[currentInstruction]?.text}</span>
                </div>
                <Progress value={recordingProgress} className="h-2" />
              </div>
            </div>
          </div>
        ) : state === 'preview' ? (
          <div className="space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden max-w-sm mx-auto">
              <video
                ref={previewVideoRef}
                src={previewUrl}
                className="w-full h-full object-cover"
                controls
                playsInline
              />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              Revise o vídeo. Se estiver bom, clique em "Confirmar e Enviar".
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={retryRecording}
                className="flex-1"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Gravar Novamente
              </Button>
              <Button
                type="button"
                onClick={uploadVideo}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white"
              >
                <Check className="h-4 w-4 mr-2" />
                Confirmar e Enviar
              </Button>
            </div>
          </div>
        ) : state === 'uploading' ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            <p className="text-gray-500">Enviando verificação facial...</p>
            <p className="text-xs text-gray-400">Isso pode levar alguns segundos</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
