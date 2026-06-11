import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuthStore } from "@/stores/auth";
import { 
  ShoppingBag, 
  Wallet, 
  LogOut, 
  Menu, 
  X,
  Package,
  DollarSign,
  Clock
} from "lucide-react";
import { signOut } from "@/lib/auth";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { maskEmail } from "@/lib/user-display";

const customerMenuItems = [
  {
    title: "Histrico de Compras",
    href: "/purchase-history",
    icon: Clock,
    description: "Histrico detalhado de todas as compras"
  },
  {
    title: "Meu Saldo", 
    href: "/my-balance",
    icon: Wallet,
    description: "Saldo de reembolsos aprovados"
  }
];

interface CustomerSidebarProps {
  className?: string;
}

export function CustomerSidebar({ className }: CustomerSidebarProps) {
  const [location, setLocation] = useLocation();
  const { user, setUser } = useAuthStore();
  const { toast } = useToast();

  // BUG FIX: NÃO RENDERIZAR CUSTOMER SIDEBAR EM PGINAS DASHBOARD
  // Evita duplicação de sidebars quando estiver no dashboard
  if (location.startsWith('/dashboard') || location.startsWith('/admin')) {
    return null; // No renderizar nada
  }

  const handleLogout = async () => {
    try {
      console.log('Iniciando logout...');
      
      // 1. Fazer logout no Firebase (isso vai disparar onAuthStateChanged que limpa tudo)
      await signOut();
      
      // 2. Limpar store manualmente (garantia extra)
      setUser(null);
      
      // 3. Mostrar mensagem de sucesso
      toast({
        title: "Logout realizado",
        description: "Vocfoi desconectado com sucesso.",
      });
      
      // 4. Redirecionar para landing page
      console.log('Logout completo, redirecionando para landing page');
      setTimeout(() => {
        window.location.href = '/';
      }, 100); // Pequeno delay para garantir que o toast apareça
      
    } catch (error) {
      console.error("Erro no logout:", error);
      toast({
        title: "Erro no logout",
        description: "Ocorreu um erro ao fazer logout. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Header */}
      <div className="border-b border-violet-900/50 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-900/50">
            <Package className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">VolatusPay Members</h2>
            <p className="text-sm text-violet-300/70">
              {user?.displayName || maskEmail(user?.email)}
            </p>
          </div>
        </div>
      </div>

      {/* Menu Items */}
      <ScrollArea className="flex-1 p-4">
        <nav className="space-y-2">
          {customerMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-violet-900/60 text-violet-200 shadow-sm"
                    : "text-violet-300 hover:bg-violet-900/40 hover:text-violet-200"
                )}
              >
                <Icon className="h-5 w-5" />
                <div className="flex-1">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-violet-400/70">
                    {item.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-violet-900/50 p-4">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-900/20"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar - FIXO */}
      <div className={cn("hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:flex lg:w-64 lg:flex-col", className)}>
        <div className="flex h-screen flex-col border-r border-violet-900/50 bg-gray-950">
          <SidebarContent />
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="fixed top-4 left-4 z-50 bg-gray-900 border-violet-700 text-violet-300 hover:bg-violet-900/50">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-gray-950 border-violet-900/50">
            <SidebarContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}