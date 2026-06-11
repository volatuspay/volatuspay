/**
 * 👥 TEAM MANAGEMENT API
 * Gestão completa de equipe, cargos e permissões
 * Apenas CEO Fundador pode acessar
 */

import { Router, Request, Response } from 'express';
import { verifyFirebaseToken, AuthenticatedRequest } from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin } from '../lib/firebase-admin.js';
import { CEO_FOUNDER_EMAIL, ROLES, DEFAULT_ROLE_PERMISSIONS, Role } from '../../shared/roles.js';

const router = Router();

// 📋 GET /api/admin/team/my-role - Buscar role do próprio usuário (PÚBLICO para admins)
router.get('/my-role', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.authUser?.uid;
    const userEmail = req.authUser?.email;
    
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHORIZED' });
    }
    
    // 👑 CEO Fundador
    if (userEmail === CEO_FOUNDER_EMAIL) {
      return res.json({
        role: ROLES.CEO_FOUNDER,
        permissions: DEFAULT_ROLE_PERMISSIONS[ROLES.CEO_FOUNDER],
        isCEO: true
      });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // 🔍 Buscar role do usuário na coleção teamMembers
    const memberSnapshot = await db.collection('teamMembers')
      .where('userId', '==', userId)
      .limit(1)
      .get();
      
    if (memberSnapshot.empty) {
      // Se não é membro da equipe, é admin padrão sem role específico
      return res.json({
        role: null,
        permissions: [],
        isCEO: false
      });
    }
    
    const memberData = memberSnapshot.docs[0].data();
    
    res.json({
      role: memberData.role,
      permissions: memberData.permissions || [],
      isCEO: false
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao buscar role do usuário:', error);
    res.status(500).json({
      error: 'Erro ao buscar role',
      details: error.message
    });
  }
});

// 🔐 MIDDLEWARE: Verificar se é CEO Fundador
const requireCEOFounder = (req: AuthenticatedRequest, res: Response, next: Function) => {
  const userEmail = req.authUser?.email;
  
  if (userEmail !== CEO_FOUNDER_EMAIL) {
    return res.status(403).json({
      error: 'Acesso negado. Apenas o CEO Fundador pode acessar esta funcionalidade.',
      code: 'FORBIDDEN'
    });
  }
  
  next();
};

// 📋 GET /api/admin/team/members - Listar todos os membros da equipe
router.get('/members', verifyFirebaseToken, requireCEOFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // 🔍 Buscar todos os membros da coleção teamMembers
    const membersSnapshot = await db.collection('teamMembers').orderBy('createdAt', 'desc').get();
    
    const members = membersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`✅ Listados ${members.length} membros da equipe`);
    
    res.json(members);
  } catch (error: any) {
    console.error('❌ Erro ao listar membros:', error);
    res.status(500).json({
      error: 'Erro ao listar membros da equipe',
      details: error.message
    });
  }
});

// ➕ POST /api/admin/team/create-user - Criar novo membro
router.post('/create-user', verifyFirebaseToken, requireCEOFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    
    // ✅ VALIDAÇÕES
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        error: 'Todos os campos são obrigatórios: name, email, password, role',
        code: 'MISSING_FIELDS'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({
        error: 'Senha deve ter no mínimo 6 caracteres',
        code: 'WEAK_PASSWORD'
      });
    }
    
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({
        error: 'Cargo inválido',
        code: 'INVALID_ROLE'
      });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // 🔍 Verificar se email já existe
    const existingMemberSnapshot = await db.collection('teamMembers')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
      
    if (!existingMemberSnapshot.empty) {
      return res.status(409).json({
        error: 'Já existe um membro com este email',
        code: 'EMAIL_ALREADY_EXISTS'
      });
    }
    
    // 🆕 CRIAR USUÁRIO NO FIREBASE AUTH
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: email.toLowerCase(),
        password: password,
        displayName: name,
        emailVerified: true
      });
      
      console.log(`✅ Usuário criado no Firebase Auth: ${userRecord.uid}`);
    } catch (authError: any) {
      if (authError.code === 'auth/email-already-exists') {
        // Se já existe no Auth, buscar o usuário
        userRecord = await admin.auth().getUserByEmail(email.toLowerCase());
        console.log(`⚠️ Usuário já existia no Auth: ${userRecord.uid}`);
      } else {
        throw authError;
      }
    }
    
    // 🔐 SETAR CUSTOM CLAIMS (admin)
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      admin: true,
      role: role,
      adminLevel: 'admin'
    });
    
    console.log(`🔐 Custom claims setadas para ${userRecord.uid}`);
    
    // 💾 CRIAR DOCUMENTO NO FIRESTORE
    const permissions = DEFAULT_ROLE_PERMISSIONS[role as Role] || [];
    
    const memberData = {
      userId: userRecord.uid,
      email: email.toLowerCase(),
      name: name,
      role: role,
      permissions: permissions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.authUser?.uid
    };
    
    const memberRef = await db.collection('teamMembers').add(memberData);
    
    console.log(`✅ Membro criado no Firestore: ${memberRef.id}`);
    
    res.status(201).json({
      id: memberRef.id,
      ...memberData,
      message: 'Membro criado com sucesso!'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao criar membro:', error);
    res.status(500).json({
      error: 'Erro ao criar membro',
      details: error.message
    });
  }
});

// 🔑 PATCH /api/admin/team/:userId/change-password - Alterar senha
router.patch('/:userId/change-password', verifyFirebaseToken, requireCEOFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 6) {
      return res.status(400).json({
        error: 'Senha deve ter no mínimo 6 caracteres',
        code: 'WEAK_PASSWORD'
      });
    }
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    
    // 🔐 ATUALIZAR SENHA NO FIREBASE AUTH
    await admin.auth().updateUser(userId, {
      password: password
    });
    
    console.log(`✅ Senha alterada para usuário: ${userId}`);
    
    res.json({
      message: 'Senha alterada com sucesso!'
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao alterar senha:', error);
    res.status(500).json({
      error: 'Erro ao alterar senha',
      details: error.message
    });
  }
});

// ✏️ PATCH /api/admin/team/:userId/update - Atualizar membro
router.patch('/:userId/update', verifyFirebaseToken, requireCEOFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { role, permissions } = req.body;
    
    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();
    
    // 🔍 Buscar membro
    const memberSnapshot = await db.collection('teamMembers')
      .where('userId', '==', userId)
      .limit(1)
      .get();
      
    if (memberSnapshot.empty) {
      return res.status(404).json({
        error: 'Membro não encontrado',
        code: 'MEMBER_NOT_FOUND'
      });
    }
    
    const memberDoc = memberSnapshot.docs[0];
    const updateData: any = {
      updatedAt: new Date().toISOString(),
      updatedBy: req.authUser?.uid
    };
    
    // Atualizar role se fornecido
    if (role) {
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({
          error: 'Cargo inválido',
          code: 'INVALID_ROLE'
        });
      }
      updateData.role = role;
      
      // Atualizar custom claims
      await admin.auth().setCustomUserClaims(userId, {
        admin: true,
        role: role,
        adminLevel: 'admin'
      });
    }
    
    // Atualizar permissions se fornecido
    if (permissions && Array.isArray(permissions)) {
      updateData.permissions = permissions;
    }
    
    await memberDoc.ref.update(updateData);
    
    console.log(`✅ Membro atualizado: ${userId}`);
    
    res.json({
      message: 'Membro atualizado com sucesso!',
      ...updateData
    });
    
  } catch (error: any) {
    console.error('❌ Erro ao atualizar membro:', error);
    res.status(500).json({
      error: 'Erro ao atualizar membro',
      details: error.message
    });
  }
});

export default router;
