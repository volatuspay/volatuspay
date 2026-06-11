import { Router } from 'express';
import { storage } from '../storage';
import { verifyFirebaseToken, requireAdmin } from '../security/firebase-auth.js';
import type { AuthenticatedRequest } from '../security/firebase-auth.js';
import { nanoid } from 'nanoid';

const router = Router();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

const checkIsAdmin = (req: AuthenticatedRequest): boolean => {
  const user = req.user as any;
  const authUser = (req as any).authUser;
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (authUser?.isAdmin === true) return true;
  if (user.customClaims?.admin === true || user.customClaims?.superAdmin === true) return true;
  if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) return true;
  return false;
};

const serializeTimestamp = (ts: any): string | null => {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate().toISOString();
  if (ts._seconds) return new Date(ts._seconds * 1000).toISOString();
  if (ts.seconds) return new Date(ts.seconds * 1000).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string') return ts;
  return null;
};

const serializeDoc = (data: any) => {
  const result = { ...data };
  if (result.createdAt) result.createdAt = serializeTimestamp(result.createdAt);
  if (result.updatedAt) result.updatedAt = serializeTimestamp(result.updatedAt);
  if (result.lastMessageAt) result.lastMessageAt = serializeTimestamp(result.lastMessageAt);
  if (result.closedAt) result.closedAt = serializeTimestamp(result.closedAt);
  if (result.resolvedAt) result.resolvedAt = serializeTimestamp(result.resolvedAt);
  return result;
};

// 🎫 CRIAR NOVO TICKET DE SUPORTE
router.post('/tickets', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { tenantId, sellerId, sellerName, sellerEmail, category, priority, subject, description } = req.body;
    
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    if (!tenantId || !subject || !description || !category) {
      return res.status(400).json({ error: 'Campos obrigatórios: tenantId, subject, description, category' });
    }
    
    const isAdmin = user.customClaims?.admin === true;
    const isOwnTenant = user.uid === tenantId;
    
    if (!isAdmin && !isOwnTenant) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const firebaseStorage = storage as any;
    const openTicketsSnapshot = await firebaseStorage.db
      .collection('supportTickets')
      .where('tenantId', '==', tenantId)
      .where('status', 'in', ['open', 'answered'])
      .get();
    
    if (openTicketsSnapshot.size >= 2) {
      return res.status(429).json({ 
        error: 'Limite de tickets abertos atingido', 
        message: 'Você já possui 2 tickets abertos. Aguarde a resolução de um deles antes de abrir outro.'
      });
    }
    
    const ticketId = nanoid(12);
    const now = new Date();
    
    const ticketData = {
      id: ticketId,
      tenantId,
      sellerId: sellerId || user.uid,
      sellerName: sellerName || (user as any).displayName || user.email || 'Seller',
      sellerEmail: sellerEmail || user.email || '',
      category,
      priority: priority || 'normal',
      subject,
      description,
      status: 'open',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      totalMessages: 1,
      unreadBySeller: 0,
      unreadByAdmin: 1
    };
    
    await firebaseStorage.db.collection('supportTickets').doc(ticketId).set(ticketData);
    
    const messageId = nanoid(16);
    const initialMessage = {
      id: messageId,
      ticketId,
      tenantId,
      content: description,
      senderType: 'seller',
      senderId: sellerId || user.uid,
      senderName: sellerName || (user as any).displayName || user.email || 'Seller',
      messageType: 'text',
      createdAt: now,
      readBySeller: true,
      readByAdmin: false
    };
    
    await firebaseStorage.db.collection('supportMessages').doc(messageId).set(initialMessage);
    
    console.log(`✅ Ticket criado: ${ticketId} - ${subject}`);
    
    res.status(201).json({
      success: true,
      ticketId,
      message: 'Ticket criado com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao criar ticket:', error);
    res.status(500).json({ error: 'Erro ao criar ticket', message: error.message });
  }
});

// 📋 BUSCAR TICKETS DO SELLER
router.get('/tickets/my-tickets', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const firebaseStorage = storage as any;
    
    const ticketsSnapshot = await firebaseStorage.db
      .collection('supportTickets')
      .where('sellerId', '==', user.uid)
      .get();
    
    const tickets = ticketsSnapshot.docs
      .map((doc: any) => serializeDoc({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });
    
    res.json({ tickets });
  } catch (error: any) {
    console.error('❌ Erro ao buscar tickets:', error);
    res.status(500).json({ error: 'Erro ao buscar tickets', message: error.message });
  }
});

// 💬 BUSCAR MENSAGENS DE UM TICKET
router.get('/tickets/:ticketId/messages', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const firebaseStorage = storage as any;
    
    const ticketDoc = await firebaseStorage.db.collection('supportTickets').doc(ticketId).get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    const isAdmin = checkIsAdmin(req);
    const isOwnTicket = ticketData.sellerId === user.uid;
    
    if (!isAdmin && !isOwnTicket) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const messagesSnapshot = await firebaseStorage.db
      .collection('supportMessages')
      .where('ticketId', '==', ticketId)
      .get();
    
    const messages = messagesSnapshot.docs
      .map((doc: any) => serializeDoc({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      });
    
    res.json({ messages });
  } catch (error: any) {
    console.error('❌ Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro ao buscar mensagens', message: error.message });
  }
});

// 📤 ENVIAR MENSAGEM EM UM TICKET
router.post('/tickets/:ticketId/messages', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const { content, messageType = 'text' } = req.body;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    if (!content) {
      return res.status(400).json({ error: 'content é obrigatório' });
    }
    
    const firebaseStorage = storage as any;
    
    const ticketDoc = await firebaseStorage.db.collection('supportTickets').doc(ticketId).get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    const isAdmin = checkIsAdmin(req);
    const isOwnTicket = ticketData.sellerId === user.uid;
    
    if (!isAdmin && !isOwnTicket) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const senderType = isAdmin ? 'admin' : 'seller';
    
    if (!isAdmin) {
      try {
        const recentSnapshot = await firebaseStorage.db
          .collection('supportMessages')
          .where('ticketId', '==', ticketId)
          .where('senderId', '==', user.uid)
          .get();
        
        const thirtySecondsAgo = Date.now() - 30000;
        let recentCount = 0;
        recentSnapshot.docs.forEach((doc: any) => {
          const data = doc.data();
          const ts = data.createdAt;
          let msgTime = 0;
          if (ts?.toMillis) msgTime = ts.toMillis();
          else if (ts?._seconds) msgTime = ts._seconds * 1000;
          else if (ts?.seconds) msgTime = ts.seconds * 1000;
          else if (ts instanceof Date) msgTime = ts.getTime();
          else if (typeof ts === 'string') msgTime = new Date(ts).getTime();
          
          if (msgTime > thirtySecondsAgo) recentCount++;
        });
        
        if (recentCount >= 3) {
          return res.status(429).json({ 
            error: 'Anti-flood ativado',
            message: 'Você está enviando mensagens muito rápido. Aguarde 30 segundos.',
            details: { resetSeconds: 30 }
          });
        }
      } catch (floodErr) {
        console.warn('⚠️ Anti-flood check failed, allowing message:', floodErr);
      }
    }
    
    const messageId = nanoid(16);
    const now = new Date();
    
    const messageData = {
      id: messageId,
      ticketId,
      tenantId: ticketData.tenantId,
      content,
      senderType,
      senderId: user.uid,
      senderName: (user as any).displayName || user.email || (isAdmin ? 'Admin' : 'Seller'),
      messageType,
      createdAt: now,
      readBySeller: senderType === 'seller',
      readByAdmin: senderType === 'admin'
    };
    
    await firebaseStorage.db.collection('supportMessages').doc(messageId).set(messageData);
    
    const updateData: any = {
      lastMessageAt: now,
      updatedAt: now,
      totalMessages: (ticketData.totalMessages || 0) + 1
    };
    
    if (senderType === 'seller') {
      updateData.unreadByAdmin = (ticketData.unreadByAdmin || 0) + 1;
      updateData.status = 'open';
    } else {
      updateData.unreadBySeller = (ticketData.unreadBySeller || 0) + 1;
      updateData.status = 'answered';
    }
    
    await firebaseStorage.db.collection('supportTickets').doc(ticketId).update(updateData);
    
    console.log(`✅ Mensagem enviada no ticket ${ticketId} por ${senderType}: ${messageId}`);
    
    res.status(201).json({
      success: true,
      messageId,
      message: 'Mensagem enviada com sucesso'
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem', message: error.message });
  }
});

// ✅ MARCAR MENSAGENS COMO LIDAS
router.post('/tickets/:ticketId/read', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params;
    const { senderType } = req.body;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    
    const firebaseStorage = storage as any;
    
    const ticketDoc = await firebaseStorage.db.collection('supportTickets').doc(ticketId).get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }
    
    const ticketData = ticketDoc.data();
    const isAdmin = checkIsAdmin(req);
    const isOwnTicket = ticketData.sellerId === user.uid;
    
    if (!isAdmin && !isOwnTicket) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const effectiveSenderType = isAdmin ? 'admin' : (senderType || 'seller');
    
    const updateData: any = {};
    if (effectiveSenderType === 'seller') {
      updateData.unreadBySeller = 0;
    } else if (effectiveSenderType === 'admin') {
      updateData.unreadByAdmin = 0;
    }
    
    await firebaseStorage.db.collection('supportTickets').doc(ticketId).update(updateData);
    
    const messagesSnapshot = await firebaseStorage.db
      .collection('supportMessages')
      .where('ticketId', '==', ticketId)
      .get();
    
    const batch = firebaseStorage.db.batch();
    messagesSnapshot.docs.forEach((doc: any) => {
      if (effectiveSenderType === 'seller') {
        batch.update(doc.ref, { readBySeller: true });
      } else if (effectiveSenderType === 'admin') {
        batch.update(doc.ref, { readByAdmin: true });
      }
    });
    
    await batch.commit();
    
    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas'
    });
  } catch (error: any) {
    console.error('❌ Erro ao marcar mensagens como lidas:', error);
    res.status(500).json({ error: 'Erro ao marcar mensagens', message: error.message });
  }
});

export default router;
