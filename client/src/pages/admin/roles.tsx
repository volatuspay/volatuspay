import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2 } from "lucide-react";
import { ROLES, ROLE_LABELS, ROLE_COLORS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, Role } from "@shared/roles";

const PERMISSION_LABELS: Record<string, string> = {
  view_support: "Visualizar Suporte",
  manage_support: "Gerenciar Suporte",
  view_dashboard: "Visualizar Dashboard",
  view_analytics: "Visualizar Analytics",
  view_transactions: "Visualizar Transações",
  approve_withdrawals: "Aprovar Saques",
  refund_withdrawals: "Saques Reembolso",
  view_sellers: "Visualizar Sellers",
  approve_sellers: "Aprovar Sellers",
  manage_sellers: "Gerenciar Sellers",
  view_risk_sellers: "Sellers de Risco",
  view_products: "Visualizar Produtos",
  manage_products: "Gerenciar Produtos",
  manage_banners: "Gerenciar Banners",
  manage_acquirers: "Gerenciar Adquirentes",
  reset_accounts: "Reset de Contas",
  manage_configs: "Gerenciar Configurações",
  view_security: "Visualizar Segurana",
  manage_security: "Gerenciar Segurana",
  manage_achievements: "Gerenciar Premiaes",
  manage_team: "Gerenciar Equipe",
  manage_roles: "Gerenciar Cargos",
  manage_permissions: "Gerenciar Permisses",
};

export default function RolesPage() {
  const roles = Object.entries(ROLE_LABELS) as [Role, string][];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="w-8 h-8" />
          Cargos e Permisses
        </h1>
        <p className="text-muted-foreground mt-1">
          Visualize os cargos disponíveis e suas permisses padrão
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {roles.map(([roleKey, roleLabel]) => {
          const permissions = DEFAULT_ROLE_PERMISSIONS[roleKey] || [];
          
          return (
            <Card key={roleKey} data-testid={`card-role-${roleKey}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{roleLabel}</CardTitle>
                  <Badge className={ROLE_COLORS[roleKey]}>
                    {permissions.length} permisses
                  </Badge>
                </div>
                <CardDescription>
                  {roleKey === ROLES.CEO_FOUNDER && "Acesso total ao sistema"}
                  {roleKey === ROLES.ADMIN && "Administrador com amplos poderes"}
                  {roleKey === ROLES.MANAGER && "Gerente de operaes"}
                  {roleKey === ROLES.FINANCIAL && "Gestão financeira"}
                  {roleKey === ROLES.DEVELOPER && "Desenvolvimento e segurança"}
                  {roleKey === ROLES.MODERATOR && "Moderao bsica"}
                  {roleKey === ROLES.SUPPORT && "Atendimento ao cliente"}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold mb-3">Permisses:</h4>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {permissions.map((permission) => (
                      <div
                        key={permission}
                        className="flex items-center gap-2 text-sm"
                        data-testid={`permission-${roleKey}-${permission}`}
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                        <span className="text-muted-foreground">
                          {PERMISSION_LABELS[permission] || permission}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
