/**
 * VolatusPay — Documentos Legais LGPD-Conformes
 * Lei 13.709/2018 (LGPD) + Marco Civil da Internet (Lei 12.965/2014)
 *
 * Adaptado do VolatusShield (Fase 33) para gateway de pagamento.
 *
 * ⚠️  Configure as variáveis de ambiente para personalizar:
 *   DPO_EMAIL          — e-mail do encarregado de dados (DPO)
 *   COMPANY_LEGAL_NAME — razão social
 *   COMPANY_CNPJ       — CNPJ da empresa
 *   COMPANY_ADDRESS    — endereço completo
 */

export const POLICY_VERSION  = "1.0";
export const POLICY_DATE     = "2025-01-01";
export const DPO_EMAIL       = process.env["DPO_EMAIL"]           ?? "privacidade@volatuspay.com.br";
export const COMPANY_NAME    = process.env["COMPANY_LEGAL_NAME"]  ?? "VolatusPay";
export const COMPANY_CNPJ    = process.env["COMPANY_CNPJ"]        ?? "00.000.000/0001-00";
export const COMPANY_ADDRESS = process.env["COMPANY_ADDRESS"]     ?? "Brasil";

/* ════════════════════════════════════════════════════════════════════
   POLÍTICA DE PRIVACIDADE
   Conforme Art. 9 da LGPD — transparência sobre tratamento de dados
════════════════════════════════════════════════════════════════════ */

export const PRIVACY_POLICY = {
  version:   POLICY_VERSION,
  updatedAt: POLICY_DATE,
  title:     `Política de Privacidade — ${COMPANY_NAME}`,
  content:   `# Política de Privacidade

**Última atualização:** ${POLICY_DATE} | **Versão:** ${POLICY_VERSION}

---

## 1. Identificação do Controlador

**${COMPANY_NAME}**
CNPJ: ${COMPANY_CNPJ}
Endereço: ${COMPANY_ADDRESS}

**Encarregado pelo Tratamento de Dados (DPO)**
E-mail: ${DPO_EMAIL}
O Encarregado é responsável por receber comunicações dos titulares e da Autoridade Nacional de Proteção de Dados (ANPD), respondendo no prazo legal.

---

## 2. Âmbito desta Política

Esta Política descreve como o ${COMPANY_NAME} coleta, usa, armazena, compartilha e protege dados pessoais de vendedores, compradores e visitantes da plataforma de pagamentos, em conformidade com a **Lei Geral de Proteção de Dados — Lei 13.709/2018 (LGPD)**.

---

## 3. Dados Pessoais Coletados e Finalidades

### 3.1 Dados de Vendedores (base: contrato — Art. 7, V)

| Dado | Finalidade |
|---|---|
| Nome completo / Razão social | Identificação e cadastro |
| CPF / CNPJ | Verificação de identidade, emissão fiscal |
| E-mail | Autenticação, notificações |
| Telefone | Verificação 2FA, suporte |
| Endereço | Cadastro fiscal |
| RG / CNH (imagem) | KYC — verificação regulatória |
| Dados bancários | Repasse de recebíveis |

### 3.2 Dados de Compradores (base: contrato e obrigação legal — Art. 7, V e II)

| Dado | Finalidade |
|---|---|
| Nome | Identificação na transação |
| CPF / CNPJ | Emissão de nota fiscal, compliance |
| E-mail | Confirmação de compra e recibo |
| Chave PIX | Processamento de pagamento |
| Dados de cartão | Processados exclusivamente por Adyen/Stripe (PCI-DSS) |

### 3.3 Dados de Segurança (base: interesse legítimo — Art. 7, IX)

- Endereço IP, user-agent, device fingerprint
- Padrão de comportamento e sessão
- Logs de acesso e transações

---

## 4. Compartilhamento de Dados

Compartilhamos apenas o necessário com:

- **EfiBank / Woovi / ONZ Finance**: processamento de PIX e boleto (BR)
- **Adyen N.V. / Stripe Inc.**: processamento de cartão (PCI-DSS nível 1)
- **Bunny.net**: armazenamento de documentos de identidade
- **Receita Federal / Órgãos regulatórios**: quando exigido por lei

---

## 5. Direitos do Titular (Art. 18 LGPD)

Você pode exercer os seguintes direitos através do endpoint \`POST /api/lgpd/request\` ou pelo e-mail ${DPO_EMAIL}:

- **Acesso**: confirmação e cópia dos seus dados
- **Retificação**: correção de dados incompletos ou inexatos
- **Eliminação**: exclusão de dados tratados com base em consentimento
- **Portabilidade**: receber seus dados em formato estruturado
- **Oposição**: opor-se ao tratamento baseado em interesse legítimo
- **Revogação**: retirar consentimento a qualquer momento

**Prazo de resposta:** 15 dias úteis (Art. 18, §3)

---

## 6. Retenção de Dados

| Categoria | Prazo |
|---|---|
| Dados de transações | 7 anos (obrigação fiscal) |
| Documentos de identidade (RG/CNH) | Duração do cadastro + 5 anos |
| Logs de segurança | 90 dias |
| Dados de conta | Duração do contrato + 5 anos |

---

## 7. Segurança

Implementamos medidas técnicas e organizacionais incluindo:
- Criptografia TLS 1.3 em trânsito
- Hashing bcrypt para senhas
- Controle de acesso baseado em perfil (Firebase Auth)
- Monitoramento antifraude contínuo
- Logs de auditoria imutáveis

---

## 8. Contato e DPO

Para exercer seus direitos ou esclarecer dúvidas sobre privacidade:
**E-mail:** ${DPO_EMAIL}
`,
};

/* ════════════════════════════════════════════════════════════════════
   TERMOS DE USO
════════════════════════════════════════════════════════════════════ */

export const TERMS_OF_USE = {
  version:   POLICY_VERSION,
  updatedAt: POLICY_DATE,
  title:     `Termos de Uso — ${COMPANY_NAME}`,
  content:   `# Termos de Uso

**Última atualização:** ${POLICY_DATE} | **Versão:** ${POLICY_VERSION}

---

## 1. Aceitação

Ao utilizar a plataforma ${COMPANY_NAME}, você concorda com estes Termos de Uso. Caso não concorde, não utilize os serviços.

## 2. Descrição dos Serviços

O ${COMPANY_NAME} é uma plataforma de gateway de pagamentos que permite a vendedores cadastrados receberem pagamentos via PIX, cartão de crédito/débito e boleto bancário.

## 3. Obrigações do Vendedor

- Fornecer informações verídicas no cadastro
- Manter documentação KYC atualizada
- Não utilizar a plataforma para atividades ilícitas
- Cumprir as normas do Banco Central do Brasil

## 4. Limitação de Responsabilidade

O ${COMPANY_NAME} atua como intermediador de pagamentos e não se responsabiliza por disputas entre vendedor e comprador relacionadas ao produto ou serviço comercializado.

## 5. Encerramento de Conta

A conta pode ser encerrada por ambas as partes com aviso prévio de 30 dias. Saldos pendentes serão liquidados conforme o calendário padrão.

## 6. Lei Aplicável

Este contrato é regido pelas leis da República Federativa do Brasil. O foro da comarca de ${COMPANY_ADDRESS || "São Paulo"} é eleito para dirimir controvérsias.

**Contato:** ${DPO_EMAIL}
`,
};

/* ════════════════════════════════════════════════════════════════════
   DPA — Data Processing Agreement
   Para vendedores que atuam como controladores independentes
════════════════════════════════════════════════════════════════════ */

export const DPA = {
  version:   POLICY_VERSION,
  updatedAt: POLICY_DATE,
  title:     `Acordo de Processamento de Dados (DPA) — ${COMPANY_NAME}`,
  content:   `# Acordo de Processamento de Dados (DPA)

**Última atualização:** ${POLICY_DATE} | **Versão:** ${POLICY_VERSION}

---

## 1. Definições

- **Controlador**: o Vendedor cadastrado na plataforma, responsável pelas finalidades do tratamento dos dados de seus clientes (compradores)
- **Operador**: ${COMPANY_NAME}, que processa dados em nome do Controlador para fins de pagamento
- **Titular**: o comprador cujos dados são tratados

## 2. Objeto

Este DPA regula o tratamento de dados pessoais de compradores pelo ${COMPANY_NAME} (Operador) em nome do Vendedor (Controlador), conforme Art. 39 da LGPD.

## 3. Instruções de Tratamento

O Operador tratará os dados pessoais somente para:
- Processar pagamentos autorizados pelo Controlador
- Cumprir obrigações legais e regulatórias
- Detectar e prevenir fraudes

## 4. Medidas de Segurança

O Operador implementa as medidas descritas na Política de Privacidade e mantém certificações compatíveis com PCI-DSS para dados de cartão.

## 5. Suboperadores

O Operador utiliza os seguintes suboperadores aprovados:
- EfiBank, Woovi, ONZ Finance (processamento PIX/Boleto — BR)
- Adyen N.V., Stripe Inc. (processamento cartão — PCI-DSS)
- Bunny.net (armazenamento de arquivos)

## 6. Notificação de Incidentes

O Operador notificará o Controlador de incidentes que afetem dados de compradores no prazo de 48 horas após a detecção.

**Contato DPO:** ${DPO_EMAIL}
`,
};

/* ════════════════════════════════════════════════════════════════════
   POLÍTICA DE COOKIES
════════════════════════════════════════════════════════════════════ */

export const COOKIE_POLICY = {
  version:   POLICY_VERSION,
  updatedAt: POLICY_DATE,
  title:     `Política de Cookies — ${COMPANY_NAME}`,
  content:   `# Política de Cookies

**Última atualização:** ${POLICY_DATE} | **Versão:** ${POLICY_VERSION}

---

## 1. O que são Cookies

Cookies são pequenos arquivos armazenados no seu navegador que nos ajudam a oferecer uma melhor experiência na plataforma.

## 2. Cookies que Utilizamos

| Cookie | Tipo | Finalidade | Base Legal |
|---|---|---|---|
| session | Essencial | Manutenção da sessão autenticada | Contrato |
| csrf_token | Essencial | Proteção contra ataques CSRF | Interesse Legítimo |
| device_id | Segurança | Reconhecimento de dispositivo confiável | Interesse Legítimo |

## 3. Cookies de Terceiros

Não utilizamos cookies de rastreamento publicitário. Cookies de análise são usados apenas de forma agregada e anonimizada.

## 4. Como Gerenciar Cookies

Você pode configurar seu navegador para recusar cookies. Atenção: cookies essenciais são necessários para o funcionamento da autenticação.

## 5. Consentimento

Para cookies não essenciais, solicitamos consentimento explícito conforme Art. 7, I da LGPD. Você pode revogar o consentimento a qualquer momento em ${DPO_EMAIL}.
`,
};
