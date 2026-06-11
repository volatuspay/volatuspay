import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useState, useRef, useEffect, useCallback } from "react";
import { resolveImageUrl } from "@/lib/image-url";
import { Play, ArrowLeft, ChevronLeft, ChevronRight, Book, Clock, User, CheckCircle, Circle, BarChart3, Lock, LogOut, ChevronDown, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { LogoThemed } from "@/components/ui/logo-themed";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { getProduct, getModulesByProduct, getLessonsByModule, isUserSeller } from "@/lib/firestore";
import type { Product, Module, Lesson, Progress as ProgressType, InsertProgress, Enrollment } from "@shared/schema";
import { getAuth } from 'firebase/auth';
import { getEnrollmentsByEmail } from '@/lib/firestore';
import { useAuthStore } from '@/stores/auth';
import { useGlobalConfigStore } from '@/stores/global-config';
import { auth } from '@/lib/firebase';

// HOOK PERSONALIZADO PARA GERENCIAR PROGRESSO
function useLessonProgress(productId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  
  // Buscar enrollment real do usuário via API
  const { data: enrollment, isLoading: enrollmentLoading } = useQuery({
    queryKey: ["enrollment", user?.email, productId],
    queryFn: async (): Promise<Enrollment | null> => {
      if (!user?.email || !productId) return null;
      
      try {
        // Buscar token de autenticação
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Token de autenticação não encontrado');
        
        const response = await fetch('/api/enrollments', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) throw new Error('Erro ao buscar enrollments');
        
        const enrollments: Enrollment[] = await response.json();
        const productEnrollment = enrollments.find(e => e.productId === productId && e.status === 'active');
        return productEnrollment || null;
      } catch (error) {
        console.error('Erro ao buscar enrollment:', error);
        return null;
      }
    },
    enabled: !!user?.email && !!productId,
  });
  
  // Buscar progresso por enrollment
  const { data: progressList = [] } = useQuery({
    queryKey: ["progress", enrollment?.id],
    queryFn: async (): Promise<ProgressType[]> => {
      if (!enrollment?.id) return [];
      
      try {
        // Buscar token de autenticação
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Token de autenticação não encontrado');
        
        const response = await fetch(`/api/progress?enrollmentId=${enrollment.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) throw new Error('Erro ao buscar progresso');
        return response.json();
      } catch (error) {
        console.error('Erro ao buscar progresso:', error);
        return [];
      }
    },
    enabled: !!enrollment?.id
  });
  
  // Salvar/atualizar progresso
  const updateProgressMutation = useMutation({
    mutationFn: async (progressData: InsertProgress) => {
      if (!enrollment?.id) throw new Error('Enrollment não encontrado');
      
      try {
        // Buscar token de autenticação
        const auth = getAuth();
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('Token de autenticação não encontrado');
        
        const response = await fetch('/api/progress', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(progressData)
        });
        
        if (!response.ok) throw new Error('Erro ao salvar progresso');
        return response.json();
      } catch (error) {
        console.error('Erro ao salvar progresso:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["progress", enrollment?.id] });
    }
  });
  
  const getProgressForLesson = useCallback((lessonId: string): ProgressType | undefined => {
    return progressList.find(p => p.lessonId === lessonId);
  }, [progressList]);
  
  const updateProgress = useCallback((lessonId: string, moduleId: string, data: {
    progressPercentage?: number;
    watchedTime?: number;
    completed?: boolean;
  }) => {
    if (!enrollment || !productId) return;
    
    const progressData: InsertProgress & { enrollmentId: string } = {
      memberId: enrollment.memberId,
      lessonId,
      moduleId,
      productId,
      enrollmentId: enrollment.id, // REQUIRED: Server expects enrollmentId
      watchedSeconds: data.watchedTime || 0,
      totalSeconds: data.watchedTime ? (data.watchedTime + 300) : 300,
      currentTimestamp: data.watchedTime || 0,
      completed: data.completed || false,
      completedAt: data.completed ? new Date() : undefined,
    };
    
    updateProgressMutation.mutate(progressData);
  }, [enrollment, productId, updateProgressMutation]);
  
  return {
    enrollment,
    enrollmentLoading,
    progressList,
    getProgressForLesson,
    updateProgress,
    isUpdating: updateProgressMutation.isPending
  };
}

export default function MembersAreaPage() {
  const [, params] = useRoute("/members/:productId");
  const productId = params?.productId;
  const { user } = useAuthStore();
  const { config: dynamicConfig } = useGlobalConfigStore();
  
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSeller, setIsSeller] = useState<boolean>(false);
  const [sellerCheckLoading, setSellerCheckLoading] = useState<boolean>(true);
  
  // FORÇAR TEMA DARK FIXO NA ÁREA DE MEMBROS (preservando preferência global)
  useEffect(() => {
    const wasDarkBefore = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    
    return () => {
      // Só remove a classe dark se o usuário NÃO tinha tema dark antes
      if (!wasDarkBefore) {
        document.documentElement.classList.remove('dark');
      }
    };
  }, []);

  // VERIFICAR SE USUÁRIO É SELLER
  useEffect(() => {
    if (!user?.uid) return;
    
    setSellerCheckLoading(true);
    isUserSeller(user.uid).then((result) => {
      setIsSeller(result);
      setSellerCheckLoading(false);
    }).catch(() => {
      setIsSeller(false);
      setSellerCheckLoading(false);
    });
  }, [user?.uid]);
  
  // HOOK DE PROGRESSO
  const { 
    enrollment, 
    enrollmentLoading, 
    progressList, 
    getProgressForLesson, 
    updateProgress, 
    isUpdating 
  } = useLessonProgress(productId);

  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => getProduct(productId!),
    enabled: !!productId,
  });

  // LGICA DO BOTÃO VOLTAR - SELLER vs CLIENTE
  const getBackUrl = () => {
    if (!product || !user) return "/my-products";
    
    // Se o usuário logado é o DONO do produto (seller), volta pro editor
    if (user.email === (product as any).ownerEmail || user.email === (product as any).sellerEmail) {
      return `/dashboard/products/${productId}`;
    }
    
    // Se é cliente (tem enrollment), volta pra seus produtos
    return "/my-products";
  };

  const { data: modules = [], isLoading: modulesLoading, error: modulesError } = useQuery({
    queryKey: ["members-modules", productId],
    queryFn: async () => {
      console.log("ÁREA DE MEMBROS - Usando API backend para módulos:", productId);
      // Buscar token de autenticação para módulos
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch(`/api/modules/${productId}`, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Erro ao buscar módulos');
      
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao buscar módulos');
      }
      
      let data;
      try {
        const parsed = JSON.parse(responseText);
        data = parsed.modules || parsed;
      } catch (parseError) {
        console.error('Members modules JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de módulos');
      }
      console.log("ÁREA DE MEMBROS - API retornou:", data.length, "módulos");
      
      // BUSCAR AULAS PARA CADA MDULO
      const modulesWithLessons = await Promise.all(
        data.map(async (module: any) => {
          try {
            const lessonsResponse = await fetch(`/api/lessons/${module.id}`, {
              headers: {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json'
              }
            });
            if (lessonsResponse.ok) {
              const lessonsText = await lessonsResponse.text();
              const lessons = JSON.parse(lessonsText);
              return { ...module, lessons };
            }
          } catch (error) {
            console.error('Erro ao buscar aulas para módulo:', module.id, error);
          }
          return { ...module, lessons: [] };
        })
      );
      
      return modulesWithLessons;
    },
    enabled: !!productId,
    staleTime: 30000,
    gcTime: 60000,
    retry: 1,
  });

  const { data: lessons = [] } = useQuery({
    queryKey: ["lessons", selectedModule?.id],
    queryFn: async () => {
      console.log("PLAYER - Buscando aulas via API backend para módulo:", selectedModule!.id);
      // Buscar token de autenticação para aulas
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch(`/api/lessons/${selectedModule!.id}`, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Erro ao buscar aulas');
      
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao buscar aulas');
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Members lessons JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de aulas');
      }
      console.log("PLAYER - API aulas retornou:", data.length, "aulas");
      return data;
    },
    enabled: !!selectedModule?.id,
    staleTime: 30000,
    gcTime: 60000,
    retry: 1,
  });

  // REMOVIDO: Auto-seleo inicial para ter apenas módulos sem player
  // Agora saparecerplayer quando clicar em um card de aula

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -300, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 300, behavior: 'smooth' });
    }
  };

  // FUNÇÃO PARA BAIXAR ARQUIVO AUTOMATICAMENTE
  const handleDownloadLesson = async (lesson: Lesson, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevenir seleo da aula ao clicar em baixar
    
    if (!lesson.videoUrl || !lesson.videoUrl.trim()) {
      console.error('URL de arquivo vazia para aula:', lesson.title);
      return;
    }

    // SANITIZAR FILENAME - remover caracteres inválidos
    const sanitizeFilename = (name: string): string => {
      return name
        .replace(/[/\\?%*:|"<>]/g, '-') // Substituir caracteres inválidos
        .replace(/\s+/g, '_') // Substituir espaos por underscore
        .substring(0, 100); // Limitar tamanho
    };

    // DETECTAR EXTENSÃO REAL DA URL
    let extension = '';
    try {
      const urlPath = new URL(lesson.videoUrl).pathname;
      const match = urlPath.match(/\.([a-zA-Z0-9]+)(\?|$)/);
      if (match) {
        extension = '.' + match[1].toLowerCase();
      }
    } catch {
      // Se URL inválida, tentar regex simples
      const match = lesson.videoUrl.match(/\.([a-zA-Z0-9]+)(\?|$)/);
      if (match) extension = '.' + match[1].toLowerCase();
    }
    
    const filename = sanitizeFilename(lesson.title) + extension;

    try {
      console.log('Tentando download via fetch+blob:', lesson.title);
      
      // MTODO 1: FETCH + BLOB (Funciona com CORS, fora download mesmo cross-origin)
      const response = await fetch(lesson.videoUrl, {
        mode: 'cors',
        credentials: 'omit',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || 'arquivo';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
      
      console.log('Download concludo via blob:', filename);
    } catch (fetchError) {
      console.warn('Fetch falhou, usando fallback (nova aba):', fetchError);
      
      // MTODO 2: FALLBACK - Abrir em NOVA ABA (no navega a aba atual)
      const link = document.createElement('a');
      link.href = lesson.videoUrl;
      link.download = filename || 'arquivo';
      link.target = '_blank'; // IMPORTANTE: Abre em nova aba, não sai da área de membros
      link.rel = 'noopener noreferrer';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('Download iniciado via fallback (nova aba):', filename);
    }
  };

  const getVideoEmbedUrl = (lesson: Lesson) => {
    let { videoUrl, videoType } = lesson;
    
    // VALIDAÇÃO: URL vazia ou inválida
    if (!videoUrl || videoUrl.trim() === '') {
      console.error('URL de vdeo vazia para aula:', lesson.title);
      return '';
    }
    
    // ✅ BUNNY STREAM - Usar direto (já vem em formato iframe)
    if (videoType === 'bunny' || videoUrl.includes('iframe.mediadelivery.net')) {
      console.log('✅ BUNNY STREAM detectado:', videoUrl);
      return videoUrl;
    }
    
    // AUTO-DETECÇÃO: Se videoType no foi definido, detectar automaticamente
    if (!videoType || videoType === 'custom') {
      if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
        videoType = 'youtube';
      } else if (videoUrl.includes('vimeo.com')) {
        videoType = 'vimeo';
      } else if (videoUrl.includes('pandavideo.com') || videoUrl.includes('panda.video')) {
        videoType = 'panda';
      }
    }
    
    // YOUTUBE - Converter para embed
    if (videoType === 'youtube' || videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      // Suporta mltiplos formatos:
      // https://www.youtube.com/watch?v=VIDEO_ID
      // https://youtu.be/VIDEO_ID
      // https://www.youtube.com/embed/VIDEO_ID (jé embed)
      if (videoUrl.includes('embed/')) {
        return videoUrl; // Jé embed
      }
      
      let videoId = '';
      
      if (videoUrl.includes('watch?v=')) {
        videoId = videoUrl.split('watch?v=')[1]?.split('&')[0] || '';
      } else if (videoUrl.includes('youtu.be/')) {
        videoId = videoUrl.split('youtu.be/')[1]?.split('?')[0] || '';
      } else {
        videoId = videoUrl.split('/').pop()?.split('?')[0] || '';
      }
      
      if (!videoId) {
        console.error('ID do vdeo YouTube não encontrado:', videoUrl);
        return videoUrl; // Retorna original como fallback
      }
      
      return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0&enablejsapi=1&origin=${window.location.origin}`;
    }
    
    // VIMEO - Converter para embed
    if (videoType === 'vimeo' || videoUrl.includes('vimeo.com')) {
      // Suporta mltiplos formatos:
      // https://vimeo.com/VIDEO_ID
      // https://player.vimeo.com/video/VIDEO_ID (jé embed)
      if (videoUrl.includes('player.vimeo.com')) {
        return videoUrl; // Jé embed
      }
      
      const videoId = videoUrl.split('/').pop()?.split('?')[0] || '';
      
      if (!videoId) {
        console.error('ID do vdeo Vimeo não encontrado:', videoUrl);
        return videoUrl;
      }
      
      return `https://player.vimeo.com/video/${videoId}?title=0&byline=0&portrait=0`;
    }
    
    // PANDA VIDEO - URL de embed (suporta vrios formatos)
    if (videoType === 'panda' || videoUrl.includes('pandavideo.com') || videoUrl.includes('panda.video')) {
      // Formatos suportados:
      // https://player-vz-xxx.tv.pandavideo.com.br/embed/?v=xxxxx
      // https://player.pandavideo.com.br/embed/?v=xxxxx
      // https://app.panda.video/embed/xxxxx
      
      // Se jé URL de embed, retornar direto
      if (videoUrl.includes('/embed/') || videoUrl.includes('embed/?v=')) {
        return videoUrl;
      }
      
      // Tentar extrair ID do vdeo
      const videoIdMatch = videoUrl.match(/[?&]v=([^&]+)/);
      if (videoIdMatch) {
        const videoId = videoIdMatch[1];
        return `https://player.pandavideo.com.br/embed/?v=${videoId}`;
      }
      
      // Se não conseguir extrair, retorna original
      return videoUrl;
    }
    
    // CUSTOM/IFRAME - URL personalizada (pode ser qualquer player)
    // Aceita URLs de embed de outros players (Hotmart, Eduzz, Vturb, etc)
    return videoUrl;
  };

  // LOADING STATE MELHORADO - Evita tela branca
  if (productLoading || !product) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
          <p className="text-white text-sm">Carregando produto...</p>
        </div>
      </div>
    );
  }

  console.log("ÁREA DE MEMBROS - ProductID:", productId);
  console.log("ÁREA DE MEMBROS - Módulos carregados:", modules.length);
  console.log("Desconto: ÁREA DE MEMBROS - Lista de módulos:", modules.map(m => m.title));
  console.log("Loading módulos:", modulesLoading);
  console.log("Erro módulos:", modulesError);

  return (
    <div className="min-h-screen bg-[#0f0f10] text-white">
      {/* Header Premium Estilo Netflix com Logo */}
      <header className="bg-gradient-to-b from-black via-black/95 to-transparent backdrop-blur-lg border-b border-white/5 sticky top-0 z-50 shadow-2xl">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center">
            <LogoThemed 
              type="site"
              variant="dark"
              className="h-10 w-auto"
              fallbackText={dynamicConfig?.gatewayName || 'VolatusPay'}
            />
          </div>
          
          {/* Navegação + User Info + Botões */}
          <div className="flex items-center gap-4">
            {/* Abas de Navegação - SÓ PARA SELLERS */}
            {isSeller && (
              <div className="hidden lg:flex items-center gap-1 mr-4">
                <Link href={`/members/${productId}`}>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-white hover:text-[#2563eb] hover:bg-white/10 transition-all duration-200 rounded-lg"
                  >
                    <Book className="w-4 h-4 mr-2" />
                    <span className="font-semibold">Conteúdo</span>
                  </Button>
                </Link>
                
                <Link href="/purchase-history">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-white hover:text-[#2563eb] hover:bg-white/10 transition-all duration-200 rounded-lg"
                  >
                    <BarChart3 className="w-4 h-4 mr-2" />
                    <span className="font-semibold">Histórico de Compras</span>
                  </Button>
                </Link>
              </div>
            )}
            
            <div className="hidden md:flex items-center gap-2 text-sm text-neutral-300">
              <User className="w-4 h-4" />
              <span>{user?.email}</span>
            </div>
            
            {/* BOTÃO VOLTAR - SÓ PARA SELLERS */}
            {isSeller && (
              <Link href="/dashboard">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-white hover:text-[#2563eb] hover:bg-white/10 transition-all duration-200 rounded-lg"
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  <span className="font-semibold">Voltar</span>
                </Button>
              </Link>
            )}

            {/* BOTÃO SAIR - SÓ PARA ALUNOS/CLIENTES */}
            {!isSeller && !sellerCheckLoading && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:text-red-400 hover:bg-white/10 transition-all duration-200 rounded-lg"
                onClick={async () => {
                  try {
                    await auth.signOut();
                    window.location.href = '/';
                  } catch (error) {
                    console.error('Erro ao fazer logout:', error);
                  }
                }}
              >
                <LogOut className="w-4 h-4 mr-2" />
                <span className="font-semibold">Sair</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* LAYOUT CONDICIONAL - PLAYER ESQUERDA + MDULOS DIREITA */}
        {selectedLesson ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full mb-8">
            {/* PLAYER ESQUERDA */}
            <div className="lg:col-span-2">
              <div className="bg-black rounded-lg overflow-hidden shadow-2xl">
                <div className="aspect-video bg-gray-900 relative">
                  {(() => {
                    const embedUrl = getVideoEmbedUrl(selectedLesson);
                    
                    // DEBUG: Log para verificar URL gerada
                    console.log('VIDEO PLAYER:', {
                      title: selectedLesson.title,
                      originalUrl: selectedLesson.videoUrl,
                      videoType: selectedLesson.videoType,
                      embedUrl: embedUrl
                    });
                    
                    // VALIDAÇÃO: Mostrar erro se URL inválida
                    if (!embedUrl || embedUrl.trim() === '') {
                      return (
                        <div className="w-full h-full flex items-center justify-center bg-gray-900">
                          <div className="text-center p-8">
                            <div className="text-red-500 text-6xl mb-4">!</div>
                            <h3 className="text-xl font-bold text-white mb-2">URL de vdeo inválida</h3>
                            <p className="text-gray-400 text-sm mb-4">
                              Por favor, configure uma URL válida para esta aula
                            </p>
                            <p className="text-gray-500 text-xs mt-2">
                              URL original: {selectedLesson.videoUrl || 'no definida'}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    
                    // VERIFICAR SE YOUTUBE
                    const isYouTube = selectedLesson.videoType === 'youtube' || selectedLesson.videoUrl?.includes('youtube.com') || selectedLesson.videoUrl?.includes('youtu.be');
                    
                    return (
                      <div className="relative w-full h-full bg-gray-900">
                        <iframe
                          src={embedUrl}
                          title={selectedLesson.title}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
                          frameBorder="0"
                          loading="eager"
                          referrerPolicy="origin"
                          style={{ border: 'none' }}
                        />
                      </div>
                    );
                  })()}
                </div>
                <div className="p-6">
                  <h2 className="text-2xl font-bold text-white mb-2">{selectedLesson.title}</h2>
                  <p className="text-gray-400 mb-4">{selectedLesson.description}</p>
                  
                  {/* BOTES DE PDF E URL EXTERNA */}
                  {(selectedLesson.attachmentUrl || selectedLesson.externalUrl) && (
                    <div className="flex flex-wrap gap-3">
                      {selectedLesson.attachmentUrl && (
                        <a
                          href={selectedLesson.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-emerald-600 text-white rounded-lg transition-colors duration-200 font-medium shadow-lg hover:shadow-xl"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span>Baixar Material (PDF)</span>
                        </a>
                      )}
                      
                      {selectedLesson.externalUrl && (
                        <a
                          href={selectedLesson.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200 font-medium shadow-lg hover:shadow-xl"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          <span>Abrir Link Externo</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* LISTA DE AULAS - LATERAL DIREITA PREMIUM */}
            <div className="lg:col-span-1 max-h-screen overflow-y-auto pr-2 pb-8 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900">
              <Accordion type="multiple" className="space-y-3">
                {modules.map((module) => {
                  const completedCount = module.lessons?.filter((lesson: any) => {
                    const lessonProgress = getProgressForLesson(lesson.id);
                    return lessonProgress?.completed || false;
                  }).length || 0;
                  const totalCount = module.lessons?.length || 0;
                  
                  return (
                    <AccordionItem 
                      key={module.id} 
                      value={module.id}
                      className="bg-gradient-to-br from-gray-900 to-black rounded-xl shadow-2xl border border-gray-800 overflow-hidden"
                    >
                      <AccordionTrigger className="hover:no-underline p-4 [&[data-state=open]>div>svg]:rotate-180">
                        <div className="flex items-center justify-between w-full pr-2">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <div className="text-left flex-1">
                              <h3 className="font-bold text-white text-base leading-tight">{module.title}</h3>
                              <p className="text-gray-400 text-xs mt-1">{completedCount}/{totalCount}</p>
                            </div>
                          </div>
                          <ChevronDown className="h-5 w-5 text-gray-400 shrink-0 transition-transform duration-200" />
                        </div>
                      </AccordionTrigger>
                      
                      <AccordionContent className="p-2 pt-0">
                        {module.lessons?.filter((lesson: any) => lesson.visibility !== 'ocultar').map((lesson: any, index: number) => {
                          const lessonProgress = getProgressForLesson(lesson.id);
                          const isCompleted = lessonProgress?.completed || false;
                          const progressPercent = (lessonProgress as any)?.progressPercentage || 0;
                          const isCurrentLesson = selectedLesson?.id === lesson.id;
                          
                          const enrollmentDate = enrollment?.createdAt ? new Date(enrollment.createdAt) : null;
                          const releaseAfterDays = lesson.releaseAfterDays || 0;
                          const unlockDate = enrollmentDate ? new Date(enrollmentDate.getTime() + releaseAfterDays * 24 * 60 * 60 * 1000) : null;
                          const isLocked = unlockDate ? new Date() < unlockDate : false;
                          const daysUntilUnlock = unlockDate ? Math.ceil((unlockDate.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)) : 0;
                          
                          console.log(`🔒 DEBUG AULA "${lesson.title}":`, {
                            visibility: lesson.visibility,
                            releaseAfterDays,
                            enrollmentCreatedAt: enrollment?.createdAt,
                            enrollmentDate,
                            unlockDate,
                            isLocked,
                            daysUntilUnlock
                          });
                          
                          return (
                            <div
                              key={lesson.id}
                              className={`w-full text-left p-4 rounded-lg transition-all duration-200 mb-2 group ${
                                isLocked 
                                  ? 'cursor-not-allowed opacity-60' 
                                  : 'cursor-pointer'
                              } ${
                                isCurrentLesson
                                  ? 'bg-gray-700 border border-[#2563eb]'
                                  : 'bg-gray-800 hover:bg-gray-700'
                              }`}
                              onClick={() => {
                                if (!isLocked) {
                                  setSelectedLesson(lesson);
                                  setSelectedModule(module);
                                }
                              }}
                              title={isLocked ? `Liberação em ${daysUntilUnlock} dia${daysUntilUnlock !== 1 ? 's' : ''}` : ''}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                    isLocked
                                      ? 'bg-red-500/20'
                                      : isCompleted 
                                      ? 'bg-emerald-500/20' 
                                      : 'bg-gray-700/50'
                                  }`}>
                                    {isLocked ? (
                                      <LockKeyhole className="w-4 h-4 text-red-400" />
                                    ) : isCompleted ? (
                                      <CheckCircle className="w-4 h-4 text-[#2563eb]" />
                                    ) : (
                                      <span className="text-sm text-gray-400 font-bold">#{index + 1}</span>
                                    )}
                                  </div>
                                  
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-base line-clamp-1 text-white">
                                      {lesson.title}
                                    </p>
                                    
                                    <div className="flex items-center gap-3 text-sm mt-1">
                                      {lesson.duration && lesson.duration > 0 && (
                                        <div className="flex items-center gap-1.5 text-gray-400">
                                          <Clock className="w-4 h-4" />
                                          <span>{lesson.duration} min</span>
                                        </div>
                                      )}
                                      {isCompleted && (
                                        <span className="text-[#2563eb] font-semibold">Concluída</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }) || (
                          <p className="text-gray-500 text-sm italic p-3 text-center">Nenhuma aula disponível</p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        ) : null}

        {/* LAYOUT NETFLIX - MÓDULOS EM TEXTO + AULAS EM CARDS HORIZONTAIS */}
        {!selectedLesson && (
          <div className="max-w-screen-2xl mx-auto space-y-12">
            {modulesLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-4 border-[#2563eb] border-t-transparent rounded-full" />
                <span className="ml-3 text-white">Carregando módulos...</span>
              </div>
            ) : modules.length === 0 ? (
              <div className="text-center py-16 px-4">
                <div className="max-w-md mx-auto">
                  <div className="bg-gradient-to-br from-neutral-900/50 to-black/50 backdrop-blur-md border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <Book className="w-16 h-16 text-[#2563eb] mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-white mb-2">Sem Conteúdo Disponível</h3>
                    <p className="text-neutral-400 text-sm">
                      Este produto ainda não possui módulos ou aulas cadastradas. Entre em contato com o vendedor para mais informações.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {modules.map((module) => (
                  <NetflixModuleRow
                    key={module.id}
                    module={module}
                    selectedLesson={selectedLesson}
                    progressList={progressList}
                    getProgressForLesson={getProgressForLesson}
                    onSelectLesson={(lesson) => {
                      setSelectedLesson(lesson);
                      setSelectedModule(module);
                    }}
                    enrollment={enrollment}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// COMPONENTE VERTICAL DE MDULO - ESTILO NETFLIX POSTER
function ModuleCompactCard({ 
  module, 
  onSelectModule 
}: { 
  module: Module; 
  onSelectModule: () => void;
}) {
  return (
    <div 
      className="bg-gradient-to-b from-gray-900 to-black border border-gray-800 hover:border-[#2563eb] rounded-xl overflow-hidden shadow-2xl hover:shadow-[#2563eb]/60 transition-all duration-500 cursor-pointer group hover:scale-110 hover:z-10 hover:-translate-y-2"
      onClick={onSelectModule}
    >
      {/* CAPA VERTICAL DO MDULO - ASPECT RATIO 2:3 (POSTER NETFLIX) */}
      <div className="aspect-[2/3] relative overflow-hidden bg-gradient-to-br from-gray-800/50 to-black">
        {module.imageUrl ? (
          <>
            <img
              src={resolveImageUrl(module.imageUrl) || ''}
              alt={module.title}
              className="w-full h-full object-cover transform group-hover:scale-110 group-hover:brightness-110 transition-all duration-700 ease-out"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent opacity-70" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800/50 via-gray-900 to-black">
            <Book className="w-16 h-16 text-[#2563eb]/40" />
          </div>
        )}
        
        {/* OVERLAY DE PLAY - APARECE NO HOVER COM GLOW */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center">
          <div className="rounded-full p-5 bg-[#2563eb]/95 backdrop-blur-sm shadow-[0_0_30px_rgba(160,208,48,0.5)] transform group-hover:scale-125 transition-all duration-500">
            <Play className="w-10 h-10 text-white fill-white drop-shadow-2xl" />
          </div>
          
          {/* Texto "COMEÇAR MÓDULO" */}
          <div className="absolute bottom-8 left-0 right-0 text-center">
            <p className="text-white font-black text-sm tracking-widest drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] uppercase">
              Começar Módulo
            </p>
          </div>
        </div>
        
      </div>

      {/* INFORMAÇES DO MDULO - SÓ TÍTULO */}
      <div className="p-3">
        <h3 className="text-sm font-bold text-white mb-1 line-clamp-2 group-hover:text-[#2563eb] transition-colors leading-tight">
          {module.title}
        </h3>
      </div>
    </div>
  );
}

// COMPONENTE ESTILO NETFLIX - LINHA DE MDULO COM CARDS HORIZONTAIS
function NetflixModuleRow({ 
  module, 
  selectedLesson,
  progressList = [],
  getProgressForLesson,
  onSelectLesson,
  enrollment
}: { 
  module: Module; 
  selectedLesson: Lesson | null;
  progressList?: any[];
  getProgressForLesson?: (lessonId: string) => any;
  onSelectLesson: (lesson: Lesson) => void;
  enrollment?: any;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { data: lessons = [], isLoading: lessonsLoading, error: lessonsError } = useQuery({
    queryKey: ["lessons", module.id],
    queryFn: async () => {
      console.log("ÁREA DE MEMBROS - Buscando aulas via API backend para módulo:", module.id);
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch(`/api/lessons/${module.id}`, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Erro ao buscar aulas');
      
      // PROTEGER CONTRA "UNAUTHORIZED" BUG
      const responseText = await response.text();
      if (!responseText || responseText.trim() === 'unauthorized' || responseText.includes('unauthorized')) {
        throw new Error('Erro de autenticação - Problema ao buscar aulas do módulo');
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Members module lessons JSON parse error:', responseText.substring(0, 100));
        throw new Error('Resposta inválida do servidor de aulas do módulo');
      }
      console.log("ÁREA DE MEMBROS - API aulas retornou:", data.length, "aulas");
      return data;
    },
    staleTime: 30000,
    gcTime: 60000,
    retry: 1,
  });

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -400, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 400, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-12">
      {/* TÍTULO DO MÓDULO - TEXTO SIMPLES */}
      <div className="mb-6 border-l-4 border-[#2563eb] pl-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-white tracking-tight">
              {module.title}
            </h2>
            {module.active && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 font-medium">
                Ativo
              </Badge>
            )}
          </div>
          
          {/* BOTÕES DE NAVEGAÇÃO */}
          {lessons.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={scrollLeft}
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={scrollRight}
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
        
        <p className="text-gray-400 text-base mb-3 leading-relaxed">
          {module.description}
        </p>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Book className="w-4 h-4 text-[#2563eb]" />
            <span>{lessons.length} aula{lessons.length !== 1 ? 's' : ''}</span>
          </div>
          {lessons.length > 0 && lessons[0]?.duration && (
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>
                {Math.round(lessons.reduce((acc: number, l: any) => acc + (l.duration || 0), 0))} min total
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SCROLL HORIZONTAL DE AULAS */}
      {lessonsLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
          <span className="ml-3 text-gray-400">Carregando aulas...</span>
        </div>
      ) : lessons.length > 0 ? (
        <div 
          ref={scrollRef}
          className="flex gap-5 overflow-x-auto scrollbar-hide pb-6"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {lessons.filter((lesson: any) => lesson.visibility !== 'ocultar').map((lesson: any, index: number) => {
            const lessonProgress = getProgressForLesson ? getProgressForLesson(lesson.id) : null;
            const isCompleted = lessonProgress?.completed || false;
            const progressPercent = (lessonProgress as any)?.progressPercentage || 0;
            
            const enrollmentDate = enrollment?.createdAt ? new Date(enrollment.createdAt) : null;
            const releaseAfterDays = lesson.releaseAfterDays || 0;
            const unlockDate = enrollmentDate ? new Date(enrollmentDate.getTime() + releaseAfterDays * 24 * 60 * 60 * 1000) : null;
            const isLocked = unlockDate ? new Date() < unlockDate : false;
            const daysUntilUnlock = unlockDate ? Math.ceil((unlockDate.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000)) : 0;
            
            console.log(`🔒 DEBUG NETFLIX "${lesson.title}":`, {
              visibility: lesson.visibility,
              releaseAfterDays,
              enrollmentCreatedAt: enrollment?.createdAt,
              enrollmentDate,
              unlockDate,
              isLocked,
              daysUntilUnlock
            });
            
            return (
              <div
                key={lesson.id}
                className={`flex-none w-64 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'} group transition-all duration-300 hover:scale-110 hover:z-20 ${
                  selectedLesson?.id === lesson.id ? 'ring-4 ring-[#2563eb] scale-105' : ''
                } ${isLocked ? 'opacity-60' : ''}`}
                onClick={() => !isLocked && onSelectLesson(lesson)}
                title={isLocked ? `Será liberada em ${daysUntilUnlock} dia${daysUntilUnlock !== 1 ? 's' : ''}` : ''}
              >
                <Card className="bg-gradient-to-b from-gray-900 to-black border border-gray-800 hover:border-[#2563eb] overflow-hidden shadow-2xl hover:shadow-emerald-500/50 transition-all duration-300">
                  <CardContent className="p-0">
                    {/* IMAGEM DA AULA - FORMATO VERTICAL 2:3 */}
                    <div className="aspect-[2/3] relative overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900">
                      {lesson.imageUrl && lesson.imageUrl.trim() !== '' ? (
                        <>
                          <img
                            src={resolveImageUrl(lesson.imageUrl) || ''}
                            alt={lesson.title}
                            className="w-full h-full object-cover"
                            onLoad={() => console.log('✅ Imagem OK:', lesson.title)}
                            onError={(e) => {
                              console.error('❌ ERRO IMAGEM:', lesson.imageUrl);
                              const target = e.currentTarget as HTMLImageElement;
                              target.style.display = 'none';
                            }}
                          />
                        </>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-800 via-gray-900 to-black flex items-center justify-center">
                          <Play className="w-16 h-16 text-gray-600" />
                        </div>
                      )}
                      
                      {/* OVERLAY DE PLAY - PREMIUM */}
                      <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent ${isLocked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-all duration-300 flex items-center justify-center`}>
                        <div className={`rounded-full p-4 backdrop-blur-sm shadow-2xl transform group-hover:scale-125 transition-transform duration-300 ${
                          isLocked ? 'bg-red-500/90' : isCompleted ? 'bg-emerald-500/90' : 'bg-[#2563eb]/90'
                        }`}>
                          {isLocked ? (
                            <LockKeyhole className="w-8 h-8 text-white" />
                          ) : isCompleted ? (
                            <CheckCircle className="w-8 h-8 text-white" />
                          ) : (
                            <Play className="w-8 h-8 text-white fill-white" />
                          )}
                        </div>
                        
                        {/* Texto "ASSISTIR AGORA" ou "BLOQUEADA" */}
                        <div className="absolute bottom-6 left-0 right-0 text-center">
                          <p className="text-white font-bold text-sm tracking-wider drop-shadow-lg">
                            {isLocked ? `BLOQUEADA ${daysUntilUnlock}D` : isCompleted ? 'ASSISTIR NOVAMENTE' : ' ASSISTIR AGORA'}
                          </p>
                        </div>
                      </div>
                      
                      {/* BADGE DE POSIÇÃO - PREMIUM */}
                      <div className="absolute top-3 left-3">
                        <Badge className="bg-black/80 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 shadow-lg">
                          #{lesson.position + 1}
                        </Badge>
                      </div>
                      
                      {/* BADGE DE PROGRESSO - TOP RIGHT */}
                      {isCompleted && (
                        <div className="absolute top-3 right-3">
                          <div className="bg-emerald-500 backdrop-blur-sm rounded-full p-2 shadow-lg transform group-hover:scale-110 transition-transform">
                            <CheckCircle className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      )}
                      {progressPercent > 0 && !isCompleted && (
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-blue-600/90 backdrop-blur-sm text-white text-sm font-bold px-3 py-1.5 shadow-lg">
                            {progressPercent}%
                          </Badge>
                        </div>
                      )}
                      
                      {/* BARRA DE PROGRESSO - BOTTOM OVERLAY */}
                      {progressPercent > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-900/80 backdrop-blur-sm">
                          <div 
                            className={`h-full transition-all duration-500 ${
                              isCompleted ? 'bg-emerald-500' : 'bg-[#2563eb]'
                            }`}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    
                    {/* INFO DA AULA - SOFISTICADA */}
                    <div className="p-5 bg-gradient-to-b from-gray-900 to-black">
                      <h3 className="font-bold text-white mb-3 line-clamp-2 text-lg leading-tight group-hover:text-[#2563eb] transition-colors">
                        {lesson.title}
                      </h3>
                      
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          {lesson.duration && lesson.duration > 0 && (
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Clock className="w-4 h-4 text-blue-500" />
                              <span className="font-semibold">{lesson.duration} min</span>
                            </div>
                          )}
                        </div>
                        
                        {/* STATUS DE PROGRESSO - TEXTO */}
                        {isCompleted && (
                          <div className="flex items-center gap-1.5 text-[#2563eb] font-semibold">
                            <CheckCircle className="w-4 h-4" />
                            <span>Concluída</span>
                          </div>
                        )}
                        {progressPercent > 0 && !isCompleted && (
                          <div className="text-blue-400 font-bold">
                            {progressPercent}%
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      ) : null}
      
    </div>
  );
}