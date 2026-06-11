import { Router, Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import bcrypt from 'bcrypt';

const router = Router();

interface RegisterMemberBody {
  name: string;
  email: string;
  whatsapp: string;
  password: string;
}

interface LoginMemberBody {
  email: string;
  password: string;
}

// 📝 REGISTRO DE MEMBRO (Cliente que comprou produtos)
router.post('/register', async (req: Request<{}, {}, RegisterMemberBody>, res: Response) => {
  try {
    const { name, email, whatsapp, password } = req.body;

    // Validação
    if (!name || !email || !whatsapp || !password) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios faltando',
        message: 'Preencha todos os campos: nome, email, whatsapp e senha'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Senha muito curta',
        message: 'A senha deve ter no mínimo 6 caracteres'
      });
    }

    const db = getFirestore();
    const auth = getAuth();

    // Verificar se já existe um membro com este email
    const membersRef = db.collection('members');
    const existingMember = await membersRef.where('email', '==', email).limit(1).get();

    if (!existingMember.empty) {
      return res.status(400).json({ 
        error: 'Email já cadastrado',
        message: 'Já existe uma conta com este email. Faça login ou use outro email.'
      });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário no Firebase Auth
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({
        email,
        password,
        displayName: name,
      });
    } catch (authError: any) {
      console.error('Erro ao criar usuário no Firebase Auth:', authError);
      
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ 
          error: 'Email já cadastrado no sistema',
          message: 'Este email já está cadastrado. Faça login.'
        });
      }
      
      throw authError;
    }

    // Criar documento do membro no Firestore
    const memberData = {
      uid: firebaseUser.uid,
      name,
      email: email.toLowerCase(),
      whatsapp,
      hashedPassword, // Guardar hash como backup
      role: 'member' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
    };

    await membersRef.doc(firebaseUser.uid).set(memberData);

    console.log('✅ Novo membro registrado:', email);

    // Criar custom token para login automático
    const customToken = await auth.createCustomToken(firebaseUser.uid, {
      role: 'member',
      email: email.toLowerCase(),
    });

    return res.status(201).json({
      message: 'Conta criada com sucesso!',
      token: customToken,
      user: {
        uid: firebaseUser.uid,
        name,
        email: email.toLowerCase(),
        role: 'member',
      },
    });

  } catch (error: any) {
    console.error('❌ Erro no registro de membro:', error);
    return res.status(500).json({ 
      error: 'Erro ao criar conta',
      message: error.message || 'Não foi possível criar sua conta. Tente novamente.'
    });
  }
});

// 🔐 LOGIN DE MEMBRO
router.post('/login', async (req: Request<{}, {}, LoginMemberBody>, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validação
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios faltando',
        message: 'Preencha email e senha'
      });
    }

    const db = getFirestore();
    const auth = getAuth();

    // Buscar membro no Firestore
    const membersRef = db.collection('members');
    const memberSnapshot = await membersRef
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();

    if (memberSnapshot.empty) {
      return res.status(401).json({ 
        error: 'Credenciais inválidas',
        message: 'Email ou senha incorretos'
      });
    }

    const memberDoc = memberSnapshot.docs[0];
    const memberData = memberDoc.data();

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, memberData.hashedPassword);

    if (!isPasswordValid) {
      return res.status(401).json({ 
        error: 'Credenciais inválidas',
        message: 'Email ou senha incorretos'
      });
    }

    // Verificar se membro está ativo
    if (memberData.isActive === false) {
      return res.status(403).json({ 
        error: 'Conta desativada',
        message: 'Sua conta foi desativada. Entre em contato com o suporte.'
      });
    }

    // Atualizar último login
    await membersRef.doc(memberDoc.id).update({
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('✅ Login de membro:', email);

    // Criar custom token
    const customToken = await auth.createCustomToken(memberData.uid, {
      role: 'member',
      email: memberData.email,
    });

    return res.status(200).json({
      message: 'Login realizado com sucesso!',
      token: customToken,
      user: {
        uid: memberData.uid,
        name: memberData.name,
        email: memberData.email,
        role: 'member',
      },
    });

  } catch (error: any) {
    console.error('❌ Erro no login de membro:', error);
    return res.status(500).json({ 
      error: 'Erro ao fazer login',
      message: error.message || 'Não foi possível fazer login. Tente novamente.'
    });
  }
});

export default router;
