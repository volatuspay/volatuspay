// 🆔 SISTEMA DEVASTADOR DE UNICIDADE CPF/CNPJ
// Garantia transacional absoluta - 1 documento = 1 conta no sistema

import { storage } from '../storage';

interface DocumentCheckResult {
  available: boolean;
  conflictType?: 'cpf' | 'cnpj';
  conflictUserId?: string;
  conflictUserEmail?: string;
  normalizedDocument: string;
}

interface DocumentRegistrationResult {
  success: boolean;
  error?: string;
  conflictDetails?: {
    existingUserId: string;
    existingEmail: string;
    documentType: 'cpf' | 'cnpj';
  };
}

// 🧠 ENGINE DE CONTROLE DE UNICIDADE
class DocumentUniquenessEngine {
  
  // 🔧 NORMALIZAR CPF/CNPJ (APENAS NÚMEROS)
  private normalizeDocument(document: string): string {
    return document.replace(/[^\d]/g, '');
  }
  
  // ✅ VALIDAR FORMATO DE CPF
  private isValidCPF(cpf: string): boolean {
    const normalizedCPF = this.normalizeDocument(cpf);
    
    // Verificar se tem 11 dígitos
    if (normalizedCPF.length !== 11) return false;
    
    // Verificar se não são todos números iguais
    if (/^(\d)\1{10}$/.test(normalizedCPF)) return false;
    
    // Validar dígitos verificadores
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(normalizedCPF.charAt(i)) * (10 - i);
    }
    let remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(normalizedCPF.charAt(9))) return false;
    
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(normalizedCPF.charAt(i)) * (11 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(normalizedCPF.charAt(10))) return false;
    
    return true;
  }
  
  // ✅ VALIDAR FORMATO DE CNPJ
  private isValidCNPJ(cnpj: string): boolean {
    const normalizedCNPJ = this.normalizeDocument(cnpj);
    
    // Verificar se tem 14 dígitos
    if (normalizedCNPJ.length !== 14) return false;
    
    // Verificar se não são todos números iguais
    if (/^(\d)\1{13}$/.test(normalizedCNPJ)) return false;
    
    // Validar primeiro dígito verificador
    let sum = 0;
    let weight = 2;
    for (let i = 11; i >= 0; i--) {
      sum += parseInt(normalizedCNPJ.charAt(i)) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    let remainder = sum % 11;
    const digit1 = remainder < 2 ? 0 : 11 - remainder;
    if (digit1 !== parseInt(normalizedCNPJ.charAt(12))) return false;
    
    // Validar segundo dígito verificador
    sum = 0;
    weight = 2;
    for (let i = 12; i >= 0; i--) {
      sum += parseInt(normalizedCNPJ.charAt(i)) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    remainder = sum % 11;
    const digit2 = remainder < 2 ? 0 : 11 - remainder;
    if (digit2 !== parseInt(normalizedCNPJ.charAt(13))) return false;
    
    return true;
  }
  
  // 🔍 VERIFICAR SE DOCUMENTO JÁ EXISTE
  async checkDocumentAvailability(document: string, documentType: 'cpf' | 'cnpj'): Promise<DocumentCheckResult> {
    const normalizedDocument = this.normalizeDocument(document);
    
    console.log(`🆔 CHECKING DOCUMENT AVAILABILITY: ${documentType.toUpperCase()} = ${normalizedDocument}`);
    
    // Validar formato
    const isValid = documentType === 'cpf' ? 
      this.isValidCPF(normalizedDocument) : 
      this.isValidCNPJ(normalizedDocument);
    
    if (!isValid) {
      return {
        available: false,
        normalizedDocument
      };
    }
    
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        throw new Error('Firebase not connected');
      }
      
      // Buscar em sellers por CPF
      if (documentType === 'cpf') {
        const sellerSnapshot = await firebaseStorage.db
          .collection('sellers')
          .where('cpf', '==', normalizedDocument)
          .limit(1)
          .get();
        
        if (!sellerSnapshot.empty) {
          const existingSeller = sellerSnapshot.docs[0].data();
          console.log(`❌ CPF CONFLICT: ${normalizedDocument} already used by seller ${existingSeller.email}`);
          
          return {
            available: false,
            conflictType: 'cpf',
            conflictUserId: existingSeller.tenantId,
            conflictUserEmail: existingSeller.email,
            normalizedDocument
          };
        }
      }
      
      // Buscar em sellers por CNPJ
      if (documentType === 'cnpj') {
        const sellerSnapshot = await firebaseStorage.db
          .collection('sellers')
          .where('cnpj', '==', normalizedDocument)
          .limit(1)
          .get();
        
        if (!sellerSnapshot.empty) {
          const existingSeller = sellerSnapshot.docs[0].data();
          console.log(`❌ CNPJ CONFLICT: ${normalizedDocument} already used by seller ${existingSeller.email}`);
          
          return {
            available: false,
            conflictType: 'cnpj',
            conflictUserId: existingSeller.tenantId,
            conflictUserEmail: existingSeller.email,
            normalizedDocument
          };
        }
      }
      
      // TODO: Verificar em outras coleções quando necessário (customers, etc.)
      
      console.log(`✅ DOCUMENT AVAILABLE: ${documentType.toUpperCase()} = ${normalizedDocument}`);
      
      return {
        available: true,
        normalizedDocument
      };
      
    } catch (error: any) {
      console.error(`❌ DOCUMENT CHECK ERROR: ${error.message}`);
      throw new Error(`Failed to check document availability: ${error.message}`);
    }
  }
  
  // 🔐 REGISTRAR DOCUMENTO COM TRANSAÇÃO ATÔMICA REAL
  async registerDocumentTransactional(
    userId: string, 
    email: string, 
    document: string, 
    documentType: 'cpf' | 'cnpj',
    additionalData: any = {}
  ): Promise<DocumentRegistrationResult> {
    
    const normalizedDocument = this.normalizeDocument(document);
    
    console.log(`🔐 REGISTERING DOCUMENT TRANSACTIONAL: ${documentType.toUpperCase()} = ${normalizedDocument} for user ${email}`);
    
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        throw new Error('Firebase not connected');
      }
      
      // 🎯 TRANSAÇÃO ATÔMICA VERDADEIRA PARA GARANTIR UNICIDADE ABSOLUTA
      const result = await firebaseStorage.db.runTransaction(async (transaction: any) => {
        
        // 1️⃣ CRIAR DOCUMENTO ÚNICO COM PRECONDIÇÃO EXISTS=FALSE
        const uniqueDocPath = `document_unique/${documentType}_${normalizedDocument}`;
        const uniqueDocRef = firebaseStorage.db.collection('security').doc(uniqueDocPath);
        
        // Verificar se já existe dentro da transação
        const existingDoc = await transaction.get(uniqueDocRef);
        if (existingDoc.exists) {
          const existingData = existingDoc.data();
          throw new Error(JSON.stringify({
            code: 'DOCUMENT_ALREADY_EXISTS_ATOMIC',
            conflictUserId: existingData.userId,
            conflictUserEmail: existingData.email,
            conflictType: documentType
          }));
        }
        
        // 2️⃣ CRIAR ENTRADA ÚNICA (FALHA SE JÁ EXISTIR)
        const uniqueData = {
          userId,
          email,
          documentType,
          normalizedDocument,
          createdAt: new Date(),
          version: 1
        };
        
        // Set com precondição implícita (dentro da transação)
        transaction.set(uniqueDocRef, uniqueData);
        
        // 3️⃣ TAMBÉM VERIFICAR NAS COLEÇÕES DE USUÁRIOS EXISTENTES
        const sellerRef = firebaseStorage.db.collection('sellers').where(documentType, '==', normalizedDocument).limit(1);
        const existingSeller = await transaction.get(sellerRef);
        
        if (!existingSeller.empty) {
          const conflictData = existingSeller.docs[0].data();
          throw new Error(JSON.stringify({
            code: 'DOCUMENT_IN_USE',
            conflictUserId: conflictData.tenantId,
            conflictUserEmail: conflictData.email,
            conflictType: documentType
          }));
        }
        
        // 4️⃣ CRIAR ÍNDICE ADICIONAL PARA BUSCA RÁPIDA
        const indexPath = `document_index/${documentType}_${normalizedDocument}`;
        const indexRef = firebaseStorage.db.collection('system').doc(indexPath);
        
        const indexData = {
          userId,
          email,
          documentType,
          normalizedDocument,
          uniqueDocId: uniqueDocPath,
          createdAt: new Date(),
          isActive: true
        };
        
        transaction.set(indexRef, indexData);
        
        // 5️⃣ ATUALIZAR DADOS DO USUÁRIO ATOMICAMENTE
        if (Object.keys(additionalData).length > 0) {
          const userRef = firebaseStorage.db.collection('sellers').doc(userId);
          const updateData = {
            ...additionalData,
            [documentType]: normalizedDocument,
            [`${documentType}Verified`]: true,
            documentUniqueId: uniqueDocPath,
            updatedAt: new Date()
          };
          
          transaction.update(userRef, updateData);
        }
        
        console.log(`✅ DOCUMENT REGISTERED ATOMICALLY: ${documentType.toUpperCase()} = ${normalizedDocument} for user ${email}`);
        
        return { success: true };
      });
      
      return result;
      
    } catch (error: any) {
      console.error(`❌ ATOMIC DOCUMENT REGISTRATION ERROR: ${error.message}`);
      
      // Tentar parsear erro estruturado
      try {
        const errorData = JSON.parse(error.message);
        return {
          success: false,
          error: `Document already registered atomically`,
          conflictDetails: {
            existingUserId: errorData.conflictUserId,
            existingEmail: errorData.conflictUserEmail,
            documentType: errorData.conflictType || documentType
          }
        };
      } catch {
        // Erro não estruturado
        return {
          success: false,
          error: error.message
        };
      }
    }
  }
  
  // 🗑️ REMOVER DOCUMENTO (LIBERAR PARA REUSO)
  async releaseDocument(document: string, documentType: 'cpf' | 'cnpj'): Promise<boolean> {
    const normalizedDocument = this.normalizeDocument(document);
    
    console.log(`🗑️ RELEASING DOCUMENT: ${documentType.toUpperCase()} = ${normalizedDocument}`);
    
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        throw new Error('Firebase not connected');
      }
      
      const indexPath = `document_index/${documentType}_${normalizedDocument}`;
      const indexRef = firebaseStorage.db.collection('system').doc(indexPath);
      
      // Marcar como inativo em vez de deletar (para auditoria)
      await indexRef.update({
        isActive: false,
        releasedAt: new Date()
      });
      
      console.log(`✅ DOCUMENT RELEASED: ${documentType.toUpperCase()} = ${normalizedDocument}`);
      return true;
      
    } catch (error: any) {
      console.error(`❌ DOCUMENT RELEASE ERROR: ${error.message}`);
      return false;
    }
  }
  
  // 📊 OBTER ESTATÍSTICAS DE USO
  async getDocumentStats(): Promise<{ totalCPFs: number; totalCNPJs: number; totalActive: number }> {
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        throw new Error('Firebase not connected');
      }
      
      const indexSnapshot = await firebaseStorage.db
        .collection('system')
        .where('__name__', '>=', 'document_index/')
        .where('__name__', '<', 'document_index0')
        .get();
      
      let totalCPFs = 0;
      let totalCNPJs = 0;
      let totalActive = 0;
      
      indexSnapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        if (data.isActive) {
          totalActive++;
          if (data.documentType === 'cpf') totalCPFs++;
          if (data.documentType === 'cnpj') totalCNPJs++;
        }
      });
      
      return { totalCPFs, totalCNPJs, totalActive };
      
    } catch (error: any) {
      console.error(`❌ STATS ERROR: ${error.message}`);
      return { totalCPFs: 0, totalCNPJs: 0, totalActive: 0 };
    }
  }
  
  // 🔍 BUSCAR USUÁRIO POR DOCUMENTO
  async findUserByDocument(document: string, documentType: 'cpf' | 'cnpj'): Promise<{ userId?: string; email?: string; found: boolean }> {
    const normalizedDocument = this.normalizeDocument(document);
    
    try {
      const firebaseStorage = storage as any;
      if (!firebaseStorage.db) {
        throw new Error('Firebase not connected');
      }
      
      const indexPath = `document_index/${documentType}_${normalizedDocument}`;
      const indexDoc = await firebaseStorage.db.collection('system').doc(indexPath).get();
      
      if (indexDoc.exists && indexDoc.data().isActive) {
        const data = indexDoc.data();
        return {
          userId: data.userId,
          email: data.email,
          found: true
        };
      }
      
      return { found: false };
      
    } catch (error: any) {
      console.error(`❌ FIND USER ERROR: ${error.message}`);
      return { found: false };
    }
  }
}

// 🎯 SINGLETON GLOBAL
const documentUniquenessEngine = new DocumentUniquenessEngine();

// 🛡️ MIDDLEWARE EXPRESS PARA VERIFICAÇÃO DE UNICIDADE
export const documentUniquenessMiddleware = async (req: any, res: any, next: any) => {
  try {
    const { cpf, cnpj } = req.body;
    
    // Verificar CPF se fornecido
    if (cpf) {
      const cpfCheck = await documentUniquenessEngine.checkDocumentAvailability(cpf, 'cpf');
      if (!cpfCheck.available) {
        return res.status(409).json({
          error: 'CPF already registered',
          message: 'This CPF is already associated with another account',
          code: 'CPF_ALREADY_EXISTS',
          conflictType: 'cpf'
        });
      }
      
      // Adicionar CPF normalizado à request
      req.body.normalizedCPF = cpfCheck.normalizedDocument;
    }
    
    // Verificar CNPJ se fornecido
    if (cnpj) {
      const cnpjCheck = await documentUniquenessEngine.checkDocumentAvailability(cnpj, 'cnpj');
      if (!cnpjCheck.available) {
        return res.status(409).json({
          error: 'CNPJ already registered',
          message: 'This CNPJ is already associated with another account',
          code: 'CNPJ_ALREADY_EXISTS',
          conflictType: 'cnpj'
        });
      }
      
      // Adicionar CNPJ normalizado à request
      req.body.normalizedCNPJ = cnpjCheck.normalizedDocument;
    }
    
    next();
    
  } catch (error: any) {
    console.error('❌ Document uniqueness middleware error:', error);
    return res.status(500).json({
      error: 'Document validation failed',
      message: 'Unable to verify document uniqueness',
      code: 'DOCUMENT_CHECK_ERROR'
    });
  }
};

export { 
  documentUniquenessEngine, 
  DocumentCheckResult, 
  DocumentRegistrationResult 
};