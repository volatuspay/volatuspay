// SISTEMA DE CAMUFLAGEM DE DADOS SENSVEIS DO ADMIN
// Protege email e UID do admin principal contra visualizao no frontend

const PROTECTED_ADMIN_EMAIL = 'jr4813678@gmail.com';

/**
 * Mascara email sensvel para exibio
 * zenpagamentosbr@gmail.com "Admin Principal"
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  
  if (email.toLowerCase() === PROTECTED_ADMIN_EMAIL.toLowerCase()) {
    return 'Admin Principal';
  }
  
  return email;
}

/**
 * Mascara UID sensvel para exibio
 * Sempre mascara UIDs admin (detectado via email ou backend)
 */
export function maskUID(uid: string | null | undefined, email?: string | null): string {
  if (!uid) return '*****';
  
  // Mascarar UID se for o email admin (mais seguro que UID hardcoded)
  if (email && email.toLowerCase() === PROTECTED_ADMIN_EMAIL.toLowerCase()) {
    return '*****';
  }
  
  return uid;
}

/**
 * Mascara dados de usuário completos (para objetos)
 */
export function maskUserData(user: any): any {
  if (!user) return user;
  
  return {
    ...user,
    email: maskEmail(user.email),
    uid: maskUID(user.uid),
  };
}

/**
 * Console.log seguro que mascara dados sensveis
 */
export function safeLog(message: string, data?: any) {
  if (data && typeof data === 'object') {
    if (data.email) {
      data = { ...data, email: maskEmail(data.email) };
    }
    if (data.uid) {
      data = { ...data, uid: maskUID(data.uid) };
    }
  }
  
  console.log(message, data);
}
