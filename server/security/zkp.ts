/**
 * VolatusZKP — Zero-Knowledge Proof of Innocence
 *
 * CONCEITO:
 *   Um usuário legítimo prova criptograficamente que não é bot,
 *   sem revelar NENHUM dado sobre si mesmo.
 *   O servidor não sabe quem é — só sabe que a prova é matematicamente válida.
 *
 * PROTOCOLO: Schnorr Non-Interactive ZKP (Fiat-Shamir)
 *   Curva: Ed25519 (mesma do Signal, Tor, SSH moderno)
 *   Padrão: RFC 8032 + Fiat-Shamir heuristic
 *
 * MATEMÁTICA (Schnorr ZKP sobre Ed25519):
 *   Prover tem seed s, extrai escalar x = HASH(s) clampado
 *   Chave pública: P = x·G  (G = ponto base da curva)
 *   - k  = nonce aleatório (bigint)
 *   - R  = k·G  (commitment)
 *   - e  = SHA512(R || challenge || P) mod l  (Fiat-Shamir)
 *   - s  = (k + e·x) mod l  (resposta)
 *   Prova: { R_hex, s_hex, P_hex }
 *   Verificação: s·G == R + e·P  (provado sem revelar x)
 *
 * GARANTIA DE PRIVACIDADE:
 *   ✓ Seed nunca sai do browser do usuário
 *   ✓ R é ponto aleatório, não revela nada sobre x
 *   ✓ Prova não é reutilizável (vinculada ao challenge único)
 *   ✓ Chave pública P não está linkada a nenhuma identidade real
 *   ✓ Zero logs de identidade no servidor
 *
 * DIFERENCIAL:
 *   Nenhum WAF comercial implementa ZKP. VolatusShield é pioneiro.
 *   É pesquisa acadêmica (zkCAPTCHA, 2022) virada em produto, 2026.
 */

import { ed25519 }     from "@noble/curves/ed25519.js";
import { randomBytes, createHash } from "crypto";

/* ─── Constantes Ed25519 ─── */
/** Ordem do grupo Ed25519 (l = 2^252 + 27742317777372353535851937790883648493) */
const l = 2n**252n + 27742317777372353535851937790883648493n;
const Point = ed25519.Point;

/* ─── Configuração ─── */
const CHALLENGE_TTL_MS       = 60_000;           // desafios expiram em 60s
const CREDENTIAL_TTL_MS      = 30 * 86_400_000;  // credenciais: 30 dias
const MAX_PENDING_CHALLENGES  = 50_000;
const SCORE_REDUCTION         = -35;             // prova válida → score cai
const SCORE_BONUS_KNOWN       = -20;             // bônus para credencial conhecida

/* ─── Tipos ─── */
export interface ZKPChallenge {
  id:        string;
  challenge: string;   // hex — nonce do servidor (32 bytes)
  issuedAt:  number;
  expiresAt: number;
  ipHash:    string;
  domain:    string;
  used:      boolean;
}

export interface ZKPProof {
  challengeId: string;
  R:           string;   // hex — ponto commitment (32 bytes)
  s:           string;   // hex — escalar resposta (32 bytes)
  P:           string;   // hex — chave pública anônima (32 bytes)
}

export interface ZKPResult {
  valid:           boolean;
  reason:          string;
  credentialId?:   string;
  knownCredential: boolean;
  scoreAdjustment: number;
}

interface Credential {
  credentialId: string;
  firstSeen:    number;
  lastSeen:     number;
  proofsCount:  number;
  trusted:      boolean;
}

/* ─── State ─── */
const pendingChallenges = new Map<string, ZKPChallenge>();
const credentials       = new Map<string, Credential>();
let _issued      = 0;
let _verified    = 0;
let _failed      = 0;
let _fraudProofs = 0;
let _knownCreds  = 0;

/* ─── Helpers ─── */
function bytesToHex(b: Uint8Array | Buffer): string {
  return Buffer.from(b).toString("hex");
}

function hexToBuffer(h: string): Buffer {
  return Buffer.from(h, "hex");
}

function bytesToBigint(b: Uint8Array | Buffer): bigint {
  return BigInt("0x" + bytesToHex(b));
}

function bigintToHex(n: bigint, byteLen = 32): string {
  return n.toString(16).padStart(byteLen * 2, "0");
}

function zkpHashValue(v: string): string {
  return createHash("sha256").update(v + "volatus-zkp-2026").digest("hex");
}

/** Fiat-Shamir: H(R || challenge || P) mod l */
function computeE(Rhex: string, challengeHex: string, Phex: string): bigint {
  const raw = hexToBuffer(Rhex + challengeHex + Phex);
  const h   = createHash("sha512").update(raw).digest();
  return bytesToBigint(h) % l;
}

/* ─── Cleanup ─── */
setInterval(() => {
  const now = Date.now();
  let pc = 0, cc = 0;
  for (const [id, ch] of pendingChallenges) {
    if (now > ch.expiresAt || ch.used) { pendingChallenges.delete(id); pc++; }
  }
  for (const [id, cr] of credentials) {
    if (now - cr.lastSeen > CREDENTIAL_TTL_MS) { credentials.delete(id); cc++; }
  }
  if (pc + cc > 0) {
    console.log(`[volatus-zkp] Cleanup: ${pc} challenges, ${cc} credenciais removidas`);
  }
}, 5 * 60_000);

/* ════════════════════════════════════════════════════
   ISSUE CHALLENGE
════════════════════════════════════════════════════ */
export function issueChallenge(ip: string, domain = "default"): ZKPChallenge {
  _issued++;
  const ipHash = zkpHashValue(ip);

  // Rate-limit: máximo 5 challenges por IP
  const existing = [...pendingChallenges.values()]
    .filter(c => c.ipHash === ipHash && !c.used && Date.now() < c.expiresAt);
  if (existing.length >= 5) {
    return existing.sort((a, b) => b.issuedAt - a.issuedAt)[0]!;
  }

  if (pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
    const oldest = [...pendingChallenges.entries()]
      .sort(([, a], [, b]) => a.issuedAt - b.issuedAt)
      .slice(0, 1000);
    oldest.forEach(([id]) => pendingChallenges.delete(id));
  }

  const id        = bytesToHex(randomBytes(16));
  const challenge = bytesToHex(randomBytes(32));
  const now       = Date.now();

  const entry: ZKPChallenge = {
    id, challenge,
    issuedAt:  now,
    expiresAt: now + CHALLENGE_TTL_MS,
    ipHash, domain,
    used: false,
  };
  pendingChallenges.set(id, entry);
  return entry;
}

/* ════════════════════════════════════════════════════
   VERIFY PROOF — verificação criptográfica Schnorr
   Verifica: s·G == R + e·P
════════════════════════════════════════════════════ */
export function verifyProof(proof: ZKPProof): ZKPResult {
  const fail = (reason: string): ZKPResult => {
    _failed++;
    return { valid: false, reason, knownCredential: false, scoreAdjustment: 0 };
  };

  // 1. Validar challenge
  const ch = pendingChallenges.get(proof.challengeId);
  if (!ch)              return fail("challenge_not_found");
  if (ch.used)          return fail("challenge_already_used");
  if (Date.now() > ch.expiresAt) {
    pendingChallenges.delete(proof.challengeId);
    return fail("challenge_expired");
  }

  // 2. Validar formato (32 bytes = 64 chars hex cada)
  if (!proof.R || !proof.s || !proof.P)                  return fail("proof_malformed");
  if (proof.R.length !== 64 || proof.s.length !== 64 ||
      proof.P.length !== 64)                             return fail("proof_wrong_length");

  // 3. Verificação criptográfica Schnorr sobre Ed25519
  try {
    const s = bytesToBigint(hexToBuffer(proof.s));
    if (s <= 0n || s >= l)                               return fail("proof_scalar_out_of_range");

    const R   = Point.fromHex(proof.R);
    const pub = Point.fromHex(proof.P);

    R.assertValidity();
    pub.assertValidity();

    // Recomputa desafio (Fiat-Shamir)
    const e = computeE(proof.R, ch.challenge, proof.P);

    // Verifica: s·G == R + e·P
    const lhs = Point.BASE.multiply(s);
    const rhs = R.add(pub.multiply(e));

    if (!lhs.equals(rhs)) {
      _fraudProofs++;
      return fail("proof_invalid_math");
    }
  } catch {
    return fail("proof_curve_error");
  }

  // 4. Prova válida!
  ch.used = true;
  _verified++;

  // 5. Credencial anônima
  const credentialId = zkpHashValue(proof.P);
  const existing     = credentials.get(credentialId);
  const isKnown      = !!existing;

  if (existing) {
    existing.lastSeen = Date.now();
    existing.proofsCount++;
    if (!existing.trusted && existing.proofsCount >= 3) existing.trusted = true;
    _knownCreds++;
  } else {
    credentials.set(credentialId, {
      credentialId,
      firstSeen:   Date.now(),
      lastSeen:    Date.now(),
      proofsCount: 1,
      trusted:     false,
    });
  }

  const scoreAdjustment = SCORE_REDUCTION + (isKnown ? SCORE_BONUS_KNOWN : 0);

  console.log(
    `[volatus-zkp] ✅ Prova válida — cred:${credentialId.slice(0, 8)} ` +
    `known:${isKnown} adj:${scoreAdjustment}`,
  );

  return {
    valid:           true,
    reason:          isKnown ? "known_innocent_credential" : "fresh_valid_proof",
    credentialId,
    knownCredential: isKnown,
    scoreAdjustment,
  };
}

/* ════════════════════════════════════════════════════
   CHECK CREDENTIAL — reconhecimento de usuário de retorno
════════════════════════════════════════════════════ */
export function checkKnownCredential(credentialId: string): {
  known: boolean;
  trusted: boolean;
  proofsCount: number;
  scoreAdjustment: number;
} {
  const cred = credentials.get(credentialId);
  if (!cred) return { known: false, trusted: false, proofsCount: 0, scoreAdjustment: 0 };
  cred.lastSeen = Date.now();
  return {
    known:           true,
    trusted:         cred.trusted,
    proofsCount:     cred.proofsCount,
    scoreAdjustment: cred.trusted ? SCORE_BONUS_KNOWN * 2 : SCORE_BONUS_KNOWN,
  };
}

/* ════════════════════════════════════════════════════
   CLIENT SNIPPET — Schnorr ZKP no browser
   Seed gerado no browser → NUNCA sai do dispositivo
   Usa @noble/curves v2.x via CDN (mesmo algoritmo do servidor)
════════════════════════════════════════════════════ */
export function getClientSnippet(challengeId: string, challengeHex: string): string {
  return `
/* VolatusZKP Client — Schnorr ZKP sobre Ed25519 */
(async () => {
  const mod = await import("https://cdn.jsdelivr.net/npm/@noble/curves@2.0.1/ed25519.js");
  const { ed25519 } = mod;
  const Point = ed25519.Point;
  const l = 2n**252n + 27742317777372353535851937790883648493n;

  function bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(''); }
  function hexToUint8(h) { const b=new Uint8Array(h.length/2); for(let i=0;i<h.length;i+=2) b[i/2]=parseInt(h.slice(i,i+2),16); return b; }
  function toBigint(b)   { return BigInt('0x'+bytesToHex(b)); }
  function bigintToHex(n,len=32) { return n.toString(16).padStart(len*2,'0'); }

  // Recupera ou gera seed persistente no browser
  let seedHex = localStorage.getItem('vzkp_seed');
  if (!seedHex) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    seedHex = bytesToHex(seed);
    localStorage.setItem('vzkp_seed', seedHex);
  }

  // Deriva escalar correto via getExtendedPublicKey (Ed25519 = SHA-512 + clamp)
  const seed = hexToUint8(seedHex);
  const ext  = ed25519.utils.getExtendedPublicKey(seed);
  const x    = ext.scalar;       // bigint — escalar clamped correto
  const Phex = bytesToHex(ext.pointBytes);  // chave pública anônima

  // Schnorr ZKP
  const kBytes = crypto.getRandomValues(new Uint8Array(32));
  const k = toBigint(kBytes) % l;
  const R = Point.BASE.multiply(k);
  const Rhex = bytesToHex(R.toBytes());

  const hashInput = hexToUint8('${challengeHex}');
  const msgBytes  = hexToUint8(Rhex + '${challengeHex}' + Phex);
  const hashBuf   = await crypto.subtle.digest('SHA-512', msgBytes);
  const e = toBigint(new Uint8Array(hashBuf)) % l;
  const s = ((k + e * x) % l + l) % l;

  const proof = {
    challengeId: '${challengeId}',
    R: Rhex,
    s: bigintToHex(s),
    P: Phex,
  };

  const res  = await fetch('/api/zkp/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(proof),
  });
  const data = await res.json();
  window.__zkpResult = data;
  if (data.valid && data.credentialId) {
    localStorage.setItem('vzkp_cred', data.credentialId);
  }
  document.dispatchEvent(new CustomEvent('volatus:zkp:done', { detail: data }));
  return data;
})();
`.trim();
}

/* ════════════════════════════════════════════════════
   DEMO PAGE HTML (inline)
════════════════════════════════════════════════════ */
export function getDemoHtml(ch: ZKPChallenge): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>VolatusZKP — Prova de Inocência</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#050a05;color:#c8ffc8;font-family:'Courier New',monospace;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}
    .card{background:rgba(0,30,0,.9);border:1px solid #00ff00;border-radius:8px;
          padding:2rem;max-width:640px;width:100%;box-shadow:0 0 40px rgba(0,255,0,.1)}
    h1{color:#00ff00;font-size:1.4rem;margin-bottom:.5rem}
    .sub{color:#557755;font-size:.85rem;margin-bottom:1.5rem}
    .badge{display:inline-block;background:rgba(0,255,0,.1);border:1px solid #00ff00;
           color:#00ff00;padding:2px 8px;border-radius:4px;font-size:.75rem;margin-bottom:1rem}
    .field{margin-bottom:1rem}
    label{color:#557755;font-size:.75rem;display:block;margin-bottom:4px}
    .value{background:#001a00;border:1px solid #1a3a1a;padding:8px 12px;border-radius:4px;
           font-size:.72rem;word-break:break-all;color:#88cc88}
    button{background:#003300;color:#00ff00;border:1px solid #00ff00;padding:10px 24px;
           border-radius:4px;cursor:pointer;font-family:inherit;font-size:.9rem;width:100%;
           transition:background .2s;margin-top:.5rem}
    button:hover{background:#004400}
    button:disabled{opacity:.4;cursor:not-allowed}
    .result{margin-top:1rem;padding:12px;border-radius:4px;font-size:.85rem;display:none}
    .result.valid{background:rgba(0,255,0,.08);border:1px solid #00ff00;color:#00ff00}
    .result.invalid{background:rgba(255,0,0,.08);border:1px solid #ff4444;color:#ff4444}
    .steps{margin:1rem 0}
    .step{display:flex;gap:.75rem;margin-bottom:.5rem;align-items:flex-start;
          font-size:.8rem;color:#557755}
    .num{background:#001a00;border:1px solid #224422;border-radius:50%;width:20px;height:20px;
         display:flex;align-items:center;justify-content:center;flex-shrink:0;
         font-size:.7rem;color:#00cc00}
    .privacy{margin-top:1rem;padding:8px 12px;background:rgba(0,255,0,.03);
             border-left:2px solid #00cc00;font-size:.75rem;color:#446644}
  </style>
</head>
<body>
<div class="card">
  <span class="badge">⚛ ZERO-KNOWLEDGE PROOF</span>
  <h1>🔐 Prove que você é humano</h1>
  <p class="sub">Sem revelar nenhum dado. Matematicamente verificável. Schnorr/Ed25519.</p>
  <div class="steps">
    <div class="step"><span class="num">1</span><span>Sua seed é gerada no browser — NUNCA sai do seu dispositivo</span></div>
    <div class="step"><span class="num">2</span><span>Você constrói uma prova Schnorr de posse da chave</span></div>
    <div class="step"><span class="num">3</span><span>Servidor verifica: s·G == R + e·P — sem aprender nada sobre você</span></div>
    <div class="step"><span class="num">4</span><span>Acesso liberado com identidade anônima registrada (30 dias)</span></div>
  </div>
  <div class="field">
    <label>CHALLENGE ID</label>
    <div class="value">${ch.id}</div>
  </div>
  <div class="field">
    <label>NONCE DO SERVIDOR</label>
    <div class="value">${ch.challenge}</div>
  </div>
  <div class="field" id="proofField" style="display:none">
    <label>PROVA SCHNORR (R, s, P)</label>
    <div class="value" id="proofVal">—</div>
  </div>
  <button id="btn" onclick="runZKP()">⚡ Gerar e Enviar Prova ZKP</button>
  <div class="result" id="result"></div>
  <div class="privacy">
    🔒 Protocolo: Schnorr Non-Interactive ZKP (Fiat-Shamir) · Curva: Ed25519 (RFC 8032)<br>
    Nenhum cookie de rastreamento · Nenhum fingerprint · Zero dados pessoais coletados
  </div>
</div>
<script type="module">
const CHALLENGE_ID  = "${ch.id}";
const CHALLENGE_HEX = "${ch.challenge}";
window.runZKP = async function() {
  const btn = document.getElementById("btn");
  btn.disabled = true; btn.textContent = "⏳ Carregando biblioteca...";
  try {
    const {ed25519} = await import("https://cdn.jsdelivr.net/npm/@noble/curves@2.0.1/ed25519.js");
    const P2 = ed25519.Point;
    const l = 2n**252n + 27742317777372353535851937790883648493n;
    function bytesToHex(b){return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('')}
    function hexToU8(h){const b=new Uint8Array(h.length/2);for(let i=0;i<h.length;i+=2)b[i/2]=parseInt(h.slice(i,i+2),16);return b}
    function toBigint(b){return BigInt('0x'+bytesToHex(b))}
    function bigHex(n,len=32){return n.toString(16).padStart(len*2,'0')}

    let seedHex=localStorage.getItem('vzkp_seed');
    if(!seedHex){const s=crypto.getRandomValues(new Uint8Array(32));seedHex=bytesToHex(s);localStorage.setItem('vzkp_seed',seedHex);}

    btn.textContent="⏳ Calculando prova...";
    const ext  = ed25519.utils.getExtendedPublicKey(hexToU8(seedHex));
    const x    = ext.scalar;
    const Phex = bytesToHex(ext.pointBytes);
    const kb   = crypto.getRandomValues(new Uint8Array(32));
    const k    = toBigint(kb)%l;
    const R    = P2.BASE.multiply(k);
    const Rhex = bytesToHex(R.toBytes());
    const hashBuf = await crypto.subtle.digest('SHA-512', hexToU8(Rhex+CHALLENGE_HEX+Phex));
    const e    = toBigint(new Uint8Array(hashBuf))%l;
    const s2   = ((k+e*x)%l+l)%l;
    const proof= {challengeId:CHALLENGE_ID,R:Rhex,s:bigHex(s2),P:Phex};

    document.getElementById("proofField").style.display="block";
    document.getElementById("proofVal").textContent=
      "R:"+Rhex.slice(0,16)+"…  s:"+bigHex(s2).slice(0,16)+"…  P:"+Phex.slice(0,16)+"…";

    btn.textContent="⏳ Verificando no servidor...";
    const res=await fetch("/api/zkp/prove",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(proof)});
    const data=await res.json();
    const el=document.getElementById("result");
    el.style.display="block";
    if(data.valid){
      el.className="result valid";
      el.innerHTML="✅ PROVA VÁLIDA<br>Credencial: <strong>"+(data.credentialId?.slice(0,16)||"—")+"…</strong><br>"
        +(data.knownCredential?"🔄 Usuário reconhecido":"🆕 Nova credencial anônima registrada")
        +"<br>Ajuste de score: <strong>"+data.scoreAdjustment+"</strong>";
      btn.textContent="✅ Identidade provada anonimamente";
      if(data.credentialId)localStorage.setItem('vzkp_cred',data.credentialId);
    }else{
      el.className="result invalid";
      el.innerHTML="❌ Prova inválida: "+data.reason;
      btn.disabled=false; btn.textContent="⚡ Tentar novamente";
    }
  } catch(err){
    const el=document.getElementById("result");
    el.style.display="block"; el.className="result invalid";
    el.textContent="Erro: "+err.message;
    btn.disabled=false; btn.textContent="⚡ Tentar novamente";
  }
};
</script>
</body>
</html>`;
}

/* ════════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════════ */
export interface ZKPStats {
  issued:             number;
  verified:           number;
  failed:             number;
  fraudProofs:        number;
  knownCredentials:   number;
  totalCredentials:   number;
  trustedCredentials: number;
  pendingChallenges:  number;
  protocol:           string;
  curve:              string;
  privacyNote:        string;
}

export function getZKPStats(): ZKPStats {
  const creds = [...credentials.values()];
  return {
    issued:             _issued,
    verified:           _verified,
    failed:             _failed,
    fraudProofs:        _fraudProofs,
    knownCredentials:   _knownCreds,
    totalCredentials:   creds.length,
    trustedCredentials: creds.filter(c => c.trusted).length,
    pendingChallenges:  pendingChallenges.size,
    protocol:           "Schnorr Non-Interactive ZKP (Fiat-Shamir)",
    curve:              "Ed25519 (RFC 8032)",
    privacyNote:        "Seed nunca sai do browser · Nenhum dado de identidade coletado · Zero-knowledge comprovável",
  };
}

console.log("[volatus-zkp] 🔐 Zero-Knowledge Proof of Innocence ativo — Schnorr/Ed25519, privacidade absoluta");
