/**
 * 🏦 ROTAS EFiBank Marketplace — Subconta & Split
 *
 * GET  /api/seller/efibank-status           → status da subconta do vendedor logado
 * PUT  /api/seller/efibank-split            → vendedor configura chave PIX / ativa split
 * POST /api/admin/sellers/:id/efibank-subconta → admin cria subconta EFibank para um vendedor
 * GET  /api/admin/sellers/:id/efibank-status  → admin consulta status da subconta
 * POST /api/admin/sellers/:id/efibank-sync    → admin sincroniza status da subconta com EFibank
 */

import { Router } from 'express';
import { verifyFirebaseToken, requireAdmin, AuthenticatedRequest } from '../security/firebase-auth.js';
import { ensureFirebaseReady, getFirestore } from '../lib/firebase-admin.js';
import { neonQuery } from '../lib/neon-db.js';
import {
  createEfiSubAccount,
  getEfiSubAccount,
  testEfiCredentials,
  EfiSubAccountInput,
} from '../lib/efibank-marketplace-api.js';

const router = Router();

// ─── GET /api/seller/efibank-status ──────────────────────────────────────────
router.get('/api/seller/efibank-status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    if (!sellerId) return res.status(401).json({ error: 'Não autenticado' });

    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT efi_account_id, efi_account_status, efi_split_enabled,
               efi_pix_key, efi_account_created_at, banking_data
        FROM sellers WHERE id = ${sellerId} LIMIT 1
      `;
      row = rows[0] || null;
    }, `efiStatus:${sellerId}`);

    if (!row) return res.status(404).json({ error: 'Vendedor não encontrado' });

    return res.json({
      splitEnabled: Boolean(row.efi_split_enabled),
      accountId: row.efi_account_id || null,
      accountStatus: row.efi_account_status || null,
      pixKey: row.efi_pix_key || row.banking_data?.pixKey || null,
      createdAt: row.efi_account_created_at || null,
    });
  } catch (err: any) {
    console.error('❌ [EFI-STATUS]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar status EFibank' });
  }
});

// ─── PUT /api/seller/efibank-split ───────────────────────────────────────────
router.put('/api/seller/efibank-split', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.authUser?.uid;
    if (!sellerId) return res.status(401).json({ error: 'Não autenticado' });

    const { pixKey, enabled } = req.body as { pixKey?: string; enabled?: boolean };

    if (pixKey !== undefined) {
      if (typeof pixKey !== 'string' || pixKey.trim().length < 5) {
        return res.status(400).json({ error: 'Chave PIX inválida' });
      }
    }

    await neonQuery(async (sql) => {
      const updates: string[] = [];
      if (pixKey !== undefined) {
        await sql`UPDATE sellers SET efi_pix_key = ${pixKey.trim()}, updated_at = NOW() WHERE id = ${sellerId}`;
      }
      if (enabled !== undefined) {
        await sql`UPDATE sellers SET efi_split_enabled = ${Boolean(enabled)}, updated_at = NOW() WHERE id = ${sellerId}`;
      }
    }, `efiSplitUpdate:${sellerId}`);

    console.log(`✅ [EFI-SPLIT] Vendedor ${sellerId} atualizou split: pixKey=${pixKey ? '***' : 'n/a'}, enabled=${enabled}`);

    return res.json({ success: true, message: 'Configuração de split atualizada' });
  } catch (err: any) {
    console.error('❌ [EFI-SPLIT-UPDATE]', err.message);
    return res.status(500).json({ error: 'Erro ao atualizar configuração de split' });
  }
});

// ─── POST /api/admin/sellers/:id/efibank-subconta ────────────────────────────
router.post('/api/admin/sellers/:id/efibank-subconta', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.params.id;
    if (!sellerId) return res.status(400).json({ error: 'Seller ID obrigatório' });

    console.log(`🏦 [EFI-SUBCONTA] Admin ${req.authUser?.email} criando subconta para seller ${sellerId}`);

    // Buscar dados do vendedor
    let sellerRow: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT id, name, email, phone, document, personal_document_number,
               birth_date, address, efi_account_id, efi_account_status
        FROM sellers WHERE id = ${sellerId} LIMIT 1
      `;
      sellerRow = rows[0] || null;
    }, `efiSubcontaFetch:${sellerId}`);

    if (!sellerRow) return res.status(404).json({ error: 'Vendedor não encontrado' });

    if (sellerRow.efi_account_id) {
      return res.status(409).json({
        error: 'Vendedor já possui subconta EFibank',
        accountId: sellerRow.efi_account_id,
        status: sellerRow.efi_account_status,
      });
    }

    // Validar campos obrigatórios para KYC
    const cpf = (sellerRow.personal_document_number || sellerRow.document || '').replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) {
      return res.status(422).json({ error: 'CPF inválido ou ausente no cadastro do vendedor' });
    }
    if (!sellerRow.birth_date) {
      return res.status(422).json({ error: 'Data de nascimento ausente no cadastro do vendedor' });
    }
    if (!sellerRow.email) {
      return res.status(422).json({ error: 'E-mail ausente no cadastro do vendedor' });
    }

    const address = sellerRow.address || {};
    const phone = (sellerRow.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 10) {
      return res.status(422).json({ error: 'Telefone inválido ou ausente no cadastro do vendedor' });
    }

    const input: EfiSubAccountInput = {
      cpf,
      nome: sellerRow.name || sellerRow.email,
      nascimento: sellerRow.birth_date,
      celular: phone,
      email: sellerRow.email,
      cep: (address.zipCode || address.cep || '').replace(/\D/g, ''),
      logradouro: address.street || address.logradouro || 'Rua não informada',
      numero: address.number || address.numero || 'S/N',
      complemento: address.complement || address.complemento || '',
      bairro: address.neighborhood || address.bairro || 'Bairro não informado',
      cidade: address.city || address.cidade || 'Cidade não informada',
      uf: (address.state || address.uf || 'SP').substring(0, 2).toUpperCase(),
    };

    // Garantir Firebase
    await ensureFirebaseReady();
    const db = getFirestore();

    // Criar subconta
    const subAccount = await createEfiSubAccount(db, input);

    // Persistir no banco
    await neonQuery(async (sql) => {
      await sql`
        UPDATE sellers SET
          efi_account_id = ${subAccount.identificador},
          efi_account_status = ${subAccount.status},
          efi_account_created_at = NOW(),
          updated_at = NOW()
        WHERE id = ${sellerId}
      `;
    }, `efiSubcontaSave:${sellerId}`);

    console.log(`✅ [EFI-SUBCONTA] Subconta ${subAccount.identificador} criada para seller ${sellerId}`);

    return res.json({
      success: true,
      accountId: subAccount.identificador,
      status: subAccount.status,
      message: 'Subconta EFibank criada com sucesso',
    });
  } catch (err: any) {
    console.error('❌ [EFI-SUBCONTA-CREATE]', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao criar subconta EFibank' });
  }
});

// ─── GET /api/admin/sellers/:id/efibank-status ───────────────────────────────
router.get('/api/admin/sellers/:id/efibank-status', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.params.id;

    let row: any = null;
    await neonQuery(async (sql) => {
      const rows = await sql`
        SELECT efi_account_id, efi_account_status, efi_split_enabled,
               efi_pix_key, efi_account_created_at, banking_data, name, email
        FROM sellers WHERE id = ${sellerId} LIMIT 1
      `;
      row = rows[0] || null;
    }, `efiAdminStatus:${sellerId}`);

    if (!row) return res.status(404).json({ error: 'Vendedor não encontrado' });

    return res.json({
      sellerId,
      name: row.name,
      email: row.email,
      splitEnabled: Boolean(row.efi_split_enabled),
      accountId: row.efi_account_id || null,
      accountStatus: row.efi_account_status || null,
      pixKey: row.efi_pix_key || row.banking_data?.pixKey || null,
      createdAt: row.efi_account_created_at || null,
    });
  } catch (err: any) {
    console.error('❌ [EFI-ADMIN-STATUS]', err.message);
    return res.status(500).json({ error: 'Erro ao buscar status EFibank' });
  }
});

// ─── POST /api/admin/sellers/:id/efibank-sync ────────────────────────────────
// Sincroniza o status da subconta diretamente com a API EFibank
router.post('/api/admin/sellers/:id/efibank-sync', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const sellerId = req.params.id;

    let accountId: string | null = null;
    await neonQuery(async (sql) => {
      const rows = await sql`SELECT efi_account_id FROM sellers WHERE id = ${sellerId} LIMIT 1`;
      accountId = rows[0]?.efi_account_id || null;
    }, `efiSyncFetch:${sellerId}`);

    if (!accountId) {
      return res.status(404).json({ error: 'Vendedor não possui subconta EFibank criada' });
    }

    await ensureFirebaseReady();
    const db = getFirestore();
    const subAccount = await getEfiSubAccount(db, accountId);

    await neonQuery(async (sql) => {
      await sql`
        UPDATE sellers SET efi_account_status = ${subAccount.status}, updated_at = NOW()
        WHERE id = ${sellerId}
      `;
    }, `efiSyncSave:${sellerId}`);

    console.log(`🔄 [EFI-SYNC] Subconta ${accountId} → status: ${subAccount.status}`);

    return res.json({
      success: true,
      accountId,
      status: subAccount.status,
      saldo: subAccount.saldo,
    });
  } catch (err: any) {
    console.error('❌ [EFI-SYNC]', err.message);
    return res.status(500).json({ error: err.message || 'Erro ao sincronizar subconta' });
  }
});

// ─── GET /api/admin/efibank-test ─────────────────────────────────────────────
// Testa a conectividade e credenciais EFibank (somente admin)
router.get('/api/admin/efibank-test', verifyFirebaseToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await testEfiCredentials();
    return res.json({
      ...result,
      message: result.ok
        ? 'Credenciais EFibank válidas — conexão OK'
        : `Falha na conexão: ${result.error}`,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
