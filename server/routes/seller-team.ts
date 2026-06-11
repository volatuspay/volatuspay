/**
 * SELLER TEAM API
 * Sistema de time interno do seller — separado do sistema de admin
 * Rota base: /api/seller/team
 */

import { Router, Response } from 'express';
import { verifyFirebaseToken, AuthenticatedRequest } from '../security/firebase-auth.js';
import { ensureFirebaseReady, getAdmin } from '../lib/firebase-admin.js';
import {
  SELLER_TEAM_ROLES,
  SELLER_TEAM_ROLE_LABELS,
  MAX_SELLER_TEAM_MEMBERS,
  type SellerTeamRole,
} from '../../shared/seller-roles.js';

const router = Router();

// GET /api/seller/team/my-seller
// Verifica se o usuário autenticado é membro de time de algum seller
// Retorna { isMember, sellerUid, role } — usado no login flow
router.get('/my-seller', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();

    const snap = await db.collection('sellerTeamMembers')
      .where('memberUid', '==', uid)
      .get();

    const active = snap.docs.find(d => d.data().active === true);
    if (!active) {
      return res.json({ isMember: false });
    }

    const data = active.data();
    return res.json({
      isMember: true,
      sellerUid: data.sellerUid,
      role: data.role,
      name: data.name,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
});

// Middleware: apenas o dono do seller (ownerUid == uid autenticado) pode gerenciar o time
const requireSellerOwner = async (req: AuthenticatedRequest, res: Response, next: Function) => {
  try {
    const uid = req.authUser?.uid;
    if (!uid) return res.status(401).json({ error: 'Não autenticado' });

    await ensureFirebaseReady();
    const db = getAdmin().firestore();

    const sellerSnap = await db.collection('sellers')
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (sellerSnap.empty) {
      return res.status(403).json({ error: 'Apenas sellers aprovados podem gerenciar equipe', code: 'NOT_SELLER' });
    }

    const sellerData = sellerSnap.docs[0].data();
    if (sellerData.status !== 'approved') {
      return res.status(403).json({ error: 'Sua conta precisa estar aprovada (KYC) para usar esta funcionalidade', code: 'NOT_APPROVED' });
    }

    (req as any).sellerDoc = sellerSnap.docs[0];
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
};

// GET /api/seller/team/members — listar membros do time
router.get('/members', verifyFirebaseToken, requireSellerOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.authUser!.uid;
    await ensureFirebaseReady();
    const db = getAdmin().firestore();

    const snap = await db.collection('sellerTeamMembers')
      .where('sellerUid', '==', uid)
      .get();

    const members = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.createdAt > a.createdAt ? 1 : -1));
    return res.json(members);
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao listar membros', details: err.message });
  }
});

// POST /api/seller/team/invite — criar membro no time
router.post('/invite', verifyFirebaseToken, requireSellerOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    const ownerUid = req.authUser!.uid;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Preencha todos os campos: nome, email, senha, cargo' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }
    if (!Object.values(SELLER_TEAM_ROLES).includes(role as SellerTeamRole)) {
      return res.status(400).json({ error: 'Cargo inválido', validRoles: Object.values(SELLER_TEAM_ROLES) });
    }

    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    // Verificar limite de 5 membros e duplicidade de email (query simples, sem índice composto)
    const allMembersSnap = await db.collection('sellerTeamMembers')
      .where('sellerUid', '==', ownerUid)
      .get();

    const allMembers = allMembersSnap.docs.map(d => d.data());
    const activeCount = allMembers.filter(m => m.active === true).length;

    if (activeCount >= MAX_SELLER_TEAM_MEMBERS) {
      return res.status(409).json({
        error: `Limite de ${MAX_SELLER_TEAM_MEMBERS} membros por equipe atingido`,
        code: 'TEAM_LIMIT_REACHED'
      });
    }

    const alreadyMember = allMembers.some(m => m.email === email.toLowerCase());
    if (alreadyMember) {
      return res.status(409).json({ error: 'Este email já é membro da sua equipe', code: 'ALREADY_MEMBER' });
    }

    // Criar usuário no Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({
        email: email.toLowerCase(),
        password,
        displayName: name,
        emailVerified: true,
      });
    } catch (authErr: any) {
      if (authErr.code === 'auth/email-already-exists') {
        userRecord = await admin.auth().getUserByEmail(email.toLowerCase());
        // Verificar se esse UID já é membro de OUTRO seller
        const memberOfOtherSnap = await db.collection('sellerTeamMembers')
          .where('memberUid', '==', userRecord.uid)
          .where('active', '==', true)
          .limit(1)
          .get();
        if (!memberOfOtherSnap.empty) {
          return res.status(409).json({ error: 'Este email já pertence ao time de outro seller', code: 'MEMBER_ELSEWHERE' });
        }
      } else {
        throw authErr;
      }
    }

    // Salvar custom claim para identificar como membro de time de seller
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      sellerTeamMember: true,
      sellerOwnerUid: ownerUid,
      sellerTeamRole: role,
    });

    // Criar documento no Firestore
    const memberData = {
      sellerUid: ownerUid,
      memberUid: userRecord.uid,
      email: email.toLowerCase(),
      name,
      role,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: ownerUid,
    };

    const docRef = await db.collection('sellerTeamMembers').add(memberData);

    return res.status(201).json({
      id: docRef.id,
      ...memberData,
      roleLabel: SELLER_TEAM_ROLE_LABELS[role as SellerTeamRole],
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao criar membro', details: err.message });
  }
});

// DELETE /api/seller/team/:memberId — remover membro
router.delete('/:memberId', verifyFirebaseToken, requireSellerOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.params;
    const ownerUid = req.authUser!.uid;

    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    const docRef = db.collection('sellerTeamMembers').doc(memberId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    const data = doc.data()!;
    if (data.sellerUid !== ownerUid) {
      return res.status(403).json({ error: 'Você não pode remover membros de outro seller' });
    }

    // Desativar conta e limpar claims
    await docRef.update({ active: false, updatedAt: new Date().toISOString() });
    await admin.auth().setCustomUserClaims(data.memberUid, {});

    return res.json({ success: true, message: 'Membro removido com sucesso' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao remover membro', details: err.message });
  }
});

// PATCH /api/seller/team/:memberId/role — alterar cargo
router.patch('/:memberId/role', verifyFirebaseToken, requireSellerOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { memberId } = req.params;
    const { role } = req.body;
    const ownerUid = req.authUser!.uid;

    if (!Object.values(SELLER_TEAM_ROLES).includes(role as SellerTeamRole)) {
      return res.status(400).json({ error: 'Cargo inválido' });
    }

    await ensureFirebaseReady();
    const admin = getAdmin();
    const db = admin.firestore();

    const docRef = db.collection('sellerTeamMembers').doc(memberId);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()!.sellerUid !== ownerUid) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    const memberUid = doc.data()!.memberUid;
    await docRef.update({ role, updatedAt: new Date().toISOString() });
    await admin.auth().setCustomUserClaims(memberUid, {
      sellerTeamMember: true,
      sellerOwnerUid: ownerUid,
      sellerTeamRole: role,
    });

    return res.json({ success: true, role, roleLabel: SELLER_TEAM_ROLE_LABELS[role as SellerTeamRole] });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erro ao alterar cargo', details: err.message });
  }
});

export default router;
