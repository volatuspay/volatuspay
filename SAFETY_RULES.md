# REGRAS DE SEGURANÇA ABSOLUTAS - ZEN PAGAMENTOS GATEWAY
# MEMÓRIA ETERNA - LEIA SEMPRE ANTES DE QUALQUER MUDANÇA
# Última atualização: 2026-02-17

---

## REGRA #1: NUNCA QUEBRE O QUE ESTÁ FUNCIONANDO

Este é um ecossistema de gateway de pagamentos COMPLETO em produção.
Qualquer mudança errada pode:
- Impedir vendas reais de serem processadas
- Perder dados financeiros de sellers
- Quebrar webhooks de pagamento (Pix, cartão, boleto)
- Corromper saldos e comissões de afiliados
- Derrubar o sistema inteiro para todos os usuários

---

## REGRA #2: ANÁLISE DE RISCO OBRIGATÓRIA ANTES DE QUALQUER MUDANÇA

Antes de editar QUALQUER arquivo, SEMPRE pergunte:

1. **Este arquivo é crítico?** (auth, pagamentos, orders, balance, webhooks)
2. **Essa mudança pode afetar o fluxo de dados?** (queries, loading states, API calls)
3. **Tem race condition?** (Firebase auth, async loading, useEffect timing)
4. **Afeta outros componentes?** (imports compartilhados, stores globais, hooks)
5. **Os dados existentes serão preservados?** (Firestore, RTDB, Bunny CDN)

Se a resposta a QUALQUER uma for SIM → faça a mudança CIRÚRGICA, testando cada passo.

---

## REGRA #3: PADRÕES QUE NUNCA DEVEM SER ALTERADOS

### Loading Pattern do Dashboard (CRÍTICO - NUNCA MUDAR)
```
O dashboard usa isUserSeller() ASSÍNCRONO com useState para:
1. loading = true (estado inicial)
2. useEffect chama isUserSeller() 
3. Quando resolve: setUserType("seller"), setLoading(false)
4. Queries usam enabled: !loading && userType === "seller"

NUNCA trocar por verificação síncrona do tenant store.
A race condition com Firebase Auth causa queries vazias que são cacheadas.
```

### Ordem de Inicialização Firebase
```
1. Firebase Auth inicializa (pode levar 500ms-2s)
2. onAuthStateChanged dispara
3. Token disponível para API calls
4. Tenant store carrega
5. Queries podem executar

NUNCA fazer API calls antes do passo 3 estar completo.
```

### Dados que NUNCA podem ser deletados/recriados
```
- Coleção "orders" no Firestore (vendas reais com dinheiro)
- Coleção "balances" no Firestore (saldos financeiros)
- Coleção "affiliations" no Firestore (vínculos de afiliados)
- Coleção "commissions" no Firestore (comissões calculadas)
- Coleção "sellers" no Firestore (dados de vendedores)
- Coleção "products" no Firestore (produtos cadastrados)
- Coleção "checkouts" no Firestore (checkouts configurados)
- Coleção "paymentConfig" no Firestore (config de pagamento)
- Coleção "subscriptions" no Firestore (assinaturas ativas)
- Coleção "withdrawals" no Firestore (saques solicitados)
- Index RTDB de orders (índice de leitura rápida)
- Backups JSON no Bunny CDN
- Certificados P12 do EfíBank
- Credenciais criptografadas
```

---

## REGRA #4: ARQUIVOS DE ALTO RISCO (MÁXIMA CAUTELA)

### Backend - NUNCA modificar sem necessidade absoluta:
- `server/routes.ts` - Todas as rotas da API
- `server/routes/` - Rotas específicas (orders, balance, webhooks)
- `server/firebase-singleton.ts` - Conexão Firebase
- `server/security/` - Camadas de segurança
- `server/webhook/` - Processamento de webhooks de pagamento

### Frontend - Cuidado extremo:
- `client/src/stores/auth.ts` - Estado de autenticação
- `client/src/stores/tenant.ts` - Estado do tenant
- `client/src/lib/auth.ts` - Lógica de autenticação Firebase
- `client/src/lib/firestore.ts` - Operações Firestore cliente
- `client/src/pages/dashboard/index.tsx` - Dashboard principal
- `client/src/components/layout/sidebar.tsx` - Navegação
- `client/src/components/layout/revenue-bar.tsx` - Barra de receita

---

## REGRA #5: PROCEDIMENTO PARA MUDANÇAS SEGURAS

1. **Leia o arquivo INTEIRO** antes de editar (não adivinhe)
2. **Entenda o contexto** - imports, dependências, quem usa este código
3. **Faça mudanças CIRÚRGICAS** - mude APENAS o necessário
4. **Preserve padrões existentes** - não refatore o que funciona
5. **Teste mentalmente** - trace o fluxo de dados antes de salvar
6. **Verifique logs** - confirme que o sistema funciona após cada mudança
7. **Um arquivo por vez** quando mexendo em código crítico

---

## REGRA #6: O QUE NUNCA FAZER

- NUNCA trocar loading pattern async por sync
- NUNCA remover loading gates de queries
- NUNCA fazer DROP/DELETE em coleções do Firestore
- NUNCA recriar dados que já existem
- NUNCA alterar estrutura de IDs existentes
- NUNCA modificar webhooks sem entender o fluxo completo
- NUNCA alterar lógica de balance/comissões sem revisão tripla
- NUNCA remover middleware de segurança
- NUNCA alterar ordem de inicialização do Firebase
- NUNCA fazer "refactor grande" em código de produção sem aprovação

---

## REGRA #7: INCIDENTES PASSADOS (APRENDER COM ERROS)

### Incidente 2026-02-17: Dashboard Loading Quebrado
- **O que aconteceu**: Loading pattern do dashboard foi trocado de async (isUserSeller) para sync (tenant store)
- **Impacto**: Dashboard mostrava 0 vendas, cards vazios, dados não carregavam
- **Causa raiz**: Race condition - Firebase Auth não estava pronto quando queries executaram, arrays vazios foram cacheados pelo TanStack Query
- **Correção**: Restaurar pattern async original com loading state gate
- **Lição**: NUNCA trocar padrão async por sync em código que depende de Firebase Auth

---

## REGRA #8: FILOSOFIA GERAL

Este sistema é um gateway de pagamentos que processa DINHEIRO REAL.
Cada linha de código pode afetar o bolso de vendedores reais.
Trate cada mudança como se fosse cirurgia em um paciente vivo.
Visão de águia: veja o sistema inteiro antes de tocar em qualquer parte.
Na dúvida, NÃO MUDE. Pergunte primeiro.
