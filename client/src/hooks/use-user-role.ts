import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useTenantStore } from '@/stores/tenant';
import { auth } from '@/lib/firebase';
import { Role, ROLES, Permission } from '@shared/roles';

interface UserRoleData {
  role: Role | null;
  permissions: Permission[];
  isLoading: boolean;
  isCEO: boolean;
  hasPermission: (permission: Permission) => boolean;
}

export function useUserRole(): UserRoleData {
  const { user } = useAuthStore();
  const { tenant } = useTenantStore();
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isCEO, setIsCEO] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setPermissions([]);
      setIsCEO(false);
      setIsLoading(false);
      return;
    }

    if (tenant) {
      setRole(null);
      setPermissions([]);
      setIsCEO(false);
      setIsLoading(false);
      return;
    }

    const fetchUserRole = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          setRole(null);
          setPermissions([]);
          setIsCEO(false);
          setIsLoading(false);
          return;
        }

        const response = await fetch(`/api/admin/team/my-role`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          setRole(data.role);
          setPermissions(data.permissions || []);
          setIsCEO(data.isCEO === true);
        } else {
          setRole(null);
          setPermissions([]);
          setIsCEO(false);
        }
      } catch {
        setRole(null);
        setPermissions([]);
        setIsCEO(false);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserRole();
  }, [user, tenant]);

  const hasPermission = (permission: Permission): boolean => {
    if (isCEO) return true;
    return permissions.includes(permission);
  };

  return { role, permissions, isLoading, isCEO, hasPermission };
}
