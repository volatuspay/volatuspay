import { useAuthStore } from "@/stores/auth";
import { useTenantStore } from "@/stores/tenant";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { signOut } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { LogOut } from "lucide-react";

export function UserMenu() {
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sellerPhotoUrl, setSellerPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !tenant) return;

    const fetchSellerPhoto = async () => {
      try {
        if (!auth.currentUser) return;
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`/api/sellers/${user.uid}`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const sellerData = await response.json();
          const photoUrl =
            sellerData.profilePhoto ||
            sellerData.photoURL ||
            sellerData.documentsUrls?.selfieWithDocument ||
            null;
          setSellerPhotoUrl(photoUrl);
        }
      } catch {
        // silently fail
      }
    };

    fetchSellerPhoto();
  }, [user?.uid, tenant]);

  const getInitials = (email?: string) =>
    email ? email.substring(0, 2).toUpperCase() : "U";

  const avatarSrc = sellerPhotoUrl || user?.photoURL || undefined;

  const handleLogout = async () => {
    try {
      await signOut();
      toast({ title: "Sessão encerrada", description: "Até logo!" });
      setLocation("/login");
    } catch (err) {
      toast({
        title: "Erro ao sair",
        description: "Tente novamente em instantes.",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="focus:outline-none rounded-full"
          title="Minha conta"
          data-testid="button-user-menu"
        >
          <Avatar className="h-9 w-9 border-2 border-primary cursor-pointer hover:opacity-80 transition-opacity hover:ring-2 hover:ring-primary/40">
            <AvatarImage src={avatarSrc} alt={user?.email || "Avatar"} />
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
              {getInitials(user?.email)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none truncate">
              {user?.displayName || "Minha conta"}
            </p>
            <p className="text-xs leading-none text-muted-foreground truncate">
              {user?.email || ""}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30"
          data-testid="menuitem-logout"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sair</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
