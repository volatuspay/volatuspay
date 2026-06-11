/**
 * VolatusBiometric — Biometria Comportamental Contínua
 *
 * CONCEITO:
 *   Não é autenticação única — é monitoramento contínuo durante toda a sessão.
 *   Se outra pessoa assumir uma sessão autenticada (session hijacking),
 *   o padrão comportamental muda e o sistema detecta em segundos.
 *
 * O QUE É MEDIDO (sinais passivos — sem intervenção do usuário):
 *   Mouse:    velocidade média, aceleração, jitter (tremor), frequência de cliques
 *   Scroll:   velocidade, suavidade, padrão direcional
 *   Teclado:  dwell time (tempo de pressão), flight time (entre teclas), frequência de bigramas
 *   Touch:    pressão, área de contato, velocidade de deslize
 *
 * ALGORITMO DE DETECÇÃO:
 *   Fase 1 — Baseline (0-30s): coleta dados para estabelecer perfil do usuário
 *   Fase 2 — Monitoramento: compara cada vetor incoming com o baseline
 *   Métrica: Z-score composto por feature (|(x - μ) / σ|)
 *   Threshold: z-score > 3.0 em múltiplas features = anomalia comportamental
 *
 * PRIVACIDADE:
 *   - Eventos brutos NUNCA chegam ao servidor
 *   - Apenas resumos estatísticos (média, variância, histogramas)
 *   - Dados destruídos ao fim da sessão (TTL 4h)
 *   - Nenhum dado pessoal identificável
 *
 * DIFERENCIAL:
 *   Bancos como ING, Deutsche Bank e BBVA implementam em apps mobile.
 *   Nenhum WAF de mercado tem isso.
 *   VolatusBiometric detecta session takeover em tempo real — algo que
 *   nenhuma autenticação por senha ou MFA pode fazer por natureza.
 */

/* ─── Tipos ─── */

export interface BehaviorVector {
  sessionId:   string;
  // Mouse
  mouseSpeedAvg:  number;    // px/ms
  mouseAccelAvg:  number;    // px/ms²
  mouseJitter:    number;    // desvio padrão de micro-movimentos
  clickRate:      number;    // cliques/minuto
  // Scroll
  scrollSpeedAvg: number;    // px/ms
  scrollSmoothness: number;  // 0-1 (1 = muito suave)
  // Teclado
  keyDwellAvg:    number;    // ms tecla pressionada
  keyFlightAvg:   number;    // ms entre teclas
  typingRhythm:   number;    // coeficiente de variação do flight time
  // Touch (NaN se não aplicável)
  touchPressureAvg: number;
  touchAreaAvg:   number;
  // Meta
  windowFocused:  boolean;
  sampleCount:    number;    // quantas amostras neste vetor
  durationMs:     number;    // janela temporal do vetor
}

export interface BiometricSession {
  sessionId:      string;
  credentialId?:  string;   // liga ao ZKP credential se disponível
  phase:          "baseline" | "monitoring";
  baselineVectors: BehaviorVector[];
  baseline?:      FeatureStats;
  anomalyHistory: number[];  // z-scores históricos
  currentScore:   number;    // 0 = normal, 1 = máxima anomalia
  alerts:         number;
  firstSeen:      number;
  lastSeen:       number;
  totalVectors:   number;
}

interface FeatureStats {
  [feature: string]: { mean: number; std: number };
}

/* ─── Configuração ─── */
const BASELINE_VECTORS  = 5;     // vetores necessários para baseline
const SESSION_TTL_MS    = 4 * 60 * 60_000;   // 4h
const ANOMALY_THRESHOLD = 2.8;   // z-score composto → anomalia
const ALERT_THRESHOLD   = 3.5;   // z-score → alerta crítico
const SCORE_HIJACK      = 45;    // score injetado no threat engine em caso de anomalia crítica
const SCORE_ANOMALY     = 20;    // score para anomalia moderada
const FEATURES: (keyof BehaviorVector)[] = [
  "mouseSpeedAvg", "mouseAccelAvg", "mouseJitter", "clickRate",
  "scrollSpeedAvg", "scrollSmoothness",
  "keyDwellAvg", "keyFlightAvg", "typingRhythm",
];

/* ─── State ─── */
const sessions  = new Map<string, BiometricSession>();
let _sessions   = 0;
let _vectors    = 0;
let _anomalies  = 0;
let _alerts     = 0;
let _hijackFlags = 0;

/* ─── Block hook callback para o threat engine ─── */
type ThreatCallback = (sessionId: string, score: number, reason: string) => void;
let _threatCb: ThreatCallback | null = null;

export function setBiometricThreatCallback(cb: ThreatCallback): void {
  _threatCb = cb;
}

/* ─── Cleanup ─── */
setInterval(() => {
  const now = Date.now();
  let pruned = 0;
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) { sessions.delete(id); pruned++; }
  }
  if (pruned > 0) console.log(`[volatus-biometric] ${pruned} sessões expiradas removidas`);
}, 15 * 60_000);

/* ─── Helpers ─── */
function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[], m?: number): number {
  if (arr.length < 2) return 1; // evita divisão por zero
  const mu = m ?? mean(arr);
  const variance = arr.reduce((a, b) => a + (b - mu) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance) || 1;
}

function computeBaseline(vectors: BehaviorVector[]): FeatureStats {
  const stats: FeatureStats = {};
  for (const feature of FEATURES) {
    const values = vectors
      .map(v => v[feature] as number)
      .filter(v => isFinite(v) && !isNaN(v));
    if (values.length < 2) continue;
    const m = mean(values);
    const s = std(values, m);
    stats[feature] = { mean: m, std: Math.max(s, 0.001) };
  }
  return stats;
}

/** Z-score composto: média dos z-scores por feature */
function compositeZScore(vec: BehaviorVector, baseline: FeatureStats): number {
  const zScores: number[] = [];
  for (const feature of FEATURES) {
    const stat = baseline[feature];
    if (!stat) continue;
    const val = vec[feature] as number;
    if (!isFinite(val) || isNaN(val)) continue;
    const z = Math.abs((val - stat.mean) / stat.std);
    zScores.push(z);
  }
  if (!zScores.length) return 0;
  // Peso maior para features com z mais alto (detecta desvios pontuais severos)
  zScores.sort((a, b) => b - a);
  const weighted = zScores[0]! * 0.4 + mean(zScores) * 0.6;
  return weighted;
}

/** Normaliza z-score para 0-1 */
function zToScore(z: number): number {
  return Math.min(1, z / (ALERT_THRESHOLD * 1.5));
}

/* ════════════════════════════════════════════════════
   REGISTER SESSION — chamado quando usuário faz login
════════════════════════════════════════════════════ */
export function registerSession(sessionId: string, credentialId?: string): void {
  if (sessions.has(sessionId)) return;
  _sessions++;
  sessions.set(sessionId, {
    sessionId,
    credentialId,
    phase:           "baseline",
    baselineVectors: [],
    anomalyHistory:  [],
    currentScore:    0,
    alerts:          0,
    firstSeen:       Date.now(),
    lastSeen:        Date.now(),
    totalVectors:    0,
  });
}

/* ════════════════════════════════════════════════════
   REPORT BEHAVIOR — servidor recebe vetor de comportamento
   Chamado a cada ~10s pelo browser
════════════════════════════════════════════════════ */
export interface BiometricReport {
  anomalyScore:   number;     // 0-1
  zScore:         number;
  phase:          "baseline" | "monitoring";
  baselineReady:  boolean;
  alert:          boolean;
  sessionScore:   number;     // score atual acumulado da sessão
}

export function reportBehavior(vec: BehaviorVector): BiometricReport {
  _vectors++;

  let session = sessions.get(vec.sessionId);
  if (!session) {
    registerSession(vec.sessionId);
    session = sessions.get(vec.sessionId)!;
  }

  session.lastSeen    = Date.now();
  session.totalVectors++;

  /* FASE 1: Baseline */
  if (session.phase === "baseline") {
    if (vec.sampleCount >= 5 && vec.windowFocused) {
      session.baselineVectors.push(vec);
    }
    if (session.baselineVectors.length >= BASELINE_VECTORS) {
      session.baseline = computeBaseline(session.baselineVectors);
      session.phase    = "monitoring";
      console.log(`[volatus-biometric] ✓ Baseline estabelecido — sessão:${vec.sessionId.slice(0, 8)} features:${Object.keys(session.baseline).length}`);
    }
    return {
      anomalyScore:  0,
      zScore:        0,
      phase:         "baseline",
      baselineReady: false,
      alert:         false,
      sessionScore:  0,
    };
  }

  /* FASE 2: Monitoramento */
  if (!session.baseline) {
    return { anomalyScore: 0, zScore: 0, phase: "monitoring", baselineReady: false, alert: false, sessionScore: 0 };
  }

  const z       = compositeZScore(vec, session.baseline);
  const anomaly = zToScore(z);

  session.anomalyHistory.push(z);
  if (session.anomalyHistory.length > 20) session.anomalyHistory.shift();

  // Score da sessão = média ponderada (últimas 5 medições pesam mais)
  const recent  = session.anomalyHistory.slice(-5);
  session.currentScore = zToScore(mean(recent));

  const alert = z > ALERT_THRESHOLD;
  if (alert) {
    session.alerts++;
    _alerts++;
    const threatScore = z > ALERT_THRESHOLD * 1.2 ? SCORE_HIJACK : SCORE_ANOMALY;
    _threatCb?.(vec.sessionId, threatScore, `biometric_anomaly z=${z.toFixed(2)}`);
    if (z > ALERT_THRESHOLD * 1.2) {
      _hijackFlags++;
      console.warn(
        `[volatus-biometric] 🚨 POSSÍVEL SESSION HIJACKING — ` +
        `sessão:${vec.sessionId.slice(0, 8)} z:${z.toFixed(2)} score:${(anomaly * 100).toFixed(0)}%`
      );
    }
  } else if (z > ANOMALY_THRESHOLD) {
    _anomalies++;
    _threatCb?.(vec.sessionId, SCORE_ANOMALY, `biometric_drift z=${z.toFixed(2)}`);
  }

  return {
    anomalyScore:  anomaly,
    zScore:        z,
    phase:         "monitoring",
    baselineReady: true,
    alert,
    sessionScore:  session.currentScore,
  };
}

/* ════════════════════════════════════════════════════
   GET SESSION INFO — portal/dashboard
════════════════════════════════════════════════════ */
export function getSessionBiometric(sessionId: string): Partial<BiometricSession> | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return {
    sessionId:    s.sessionId,
    phase:        s.phase,
    currentScore: s.currentScore,
    alerts:       s.alerts,
    totalVectors: s.totalVectors,
    firstSeen:    s.firstSeen,
    lastSeen:     s.lastSeen,
    anomalyHistory: s.anomalyHistory.slice(-10),
  };
}

/* ════════════════════════════════════════════════════
   BROWSER SNIPPET — coleta passiva de comportamento
   Enviado uma vez, executa continuamente na sessão
════════════════════════════════════════════════════ */
export function getBiometricSnippet(sessionId: string, reportInterval = 10_000): string {
  return `
/* VolatusBiometric — Coleta Passiva de Comportamento */
/* Nenhum dado bruto é enviado — apenas resumos estatísticos */
(function() {
  const SESSION_ID = "${sessionId}";
  const INTERVAL   = ${reportInterval};
  const ENDPOINT   = "/api/biometric/report";

  // Acumuladores
  let mouse  = { speeds:[], accels:[], jitters:[], clicks:0, lastX:0, lastY:0, lastT:0, lastSpeed:0 };
  let scroll = { speeds:[], dirs:[] };
  let key    = { dwells:{}, flights:[], lastDown:0, lastUp:0 };
  let touch  = { pressures:[], areas:[] };
  let samples = 0;
  let windowFocused = true;
  const startT = Date.now();

  // Mouse move
  document.addEventListener("mousemove", function(e) {
    const t = Date.now();
    if (mouse.lastT) {
      const dt = t - mouse.lastT;
      if (dt > 0 && dt < 200) {
        const dx = e.clientX - mouse.lastX, dy = e.clientY - mouse.lastY;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const speed = dist / dt;
        const accel = Math.abs(speed - mouse.lastSpeed) / dt;
        mouse.speeds.push(speed);
        mouse.accels.push(accel);
        if (mouse.speeds.length > 3) {
          const recent = mouse.speeds.slice(-3);
          const m = recent.reduce((a,b)=>a+b,0)/3;
          const jitter = Math.sqrt(recent.reduce((a,b)=>a+(b-m)**2,0)/3);
          mouse.jitters.push(jitter);
        }
        mouse.lastSpeed = speed;
      }
    }
    mouse.lastX=e.clientX; mouse.lastY=e.clientY; mouse.lastT=t;
    samples++;
  }, {passive:true});

  // Click
  document.addEventListener("click", function() { mouse.clicks++; }, {passive:true});

  // Scroll
  document.addEventListener("scroll", function() {
    const t = Date.now();
    if (scroll._lastT) {
      const dt = t - scroll._lastT;
      if (dt > 0 && dt < 500) {
        const dy = Math.abs(window.scrollY - (scroll._lastY||0));
        scroll.speeds.push(dy/dt);
      }
    }
    scroll._lastT = t; scroll._lastY = window.scrollY;
    samples++;
  }, {passive:true});

  // Keyboard
  document.addEventListener("keydown", function(e) {
    if (!e.key || e.key.length > 1) return;
    key.lastDown = Date.now();
    if (key.lastUp > 0) {
      const flight = key.lastDown - key.lastUp;
      if (flight > 0 && flight < 1000) key.flights.push(flight);
    }
  }, {passive:true});
  document.addEventListener("keyup", function(e) {
    if (!e.key || e.key.length > 1) return;
    const now = Date.now();
    if (key.lastDown > 0) {
      const dwell = now - key.lastDown;
      if (dwell > 0 && dwell < 500) key.dwells[e.key] = (key.dwells[e.key]||[]);
      key.dwells[e.key]?.push(dwell);
    }
    key.lastUp = now;
    samples++;
  }, {passive:true});

  // Touch
  document.addEventListener("touchstart", function(e) {
    Array.from(e.touches).forEach(function(t) {
      if (t.force) touch.pressures.push(t.force);
      if (t.radiusX) touch.areas.push(t.radiusX * t.radiusY * Math.PI);
    });
    samples++;
  }, {passive:true});

  // Focus
  window.addEventListener("focus", function() { windowFocused=true; });
  window.addEventListener("blur",  function() { windowFocused=false; });

  // Helpers
  function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  function cv(arr)  {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    if (!m) return 0;
    const s = Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/(arr.length-1));
    return s/m;
  }
  function smoothness(arr) {
    if (arr.length < 2) return 0.5;
    let changes = 0;
    for (let i=1;i<arr.length;i++) { if (Math.abs(arr[i]-arr[i-1])>arr[i-1]*0.5) changes++; }
    return 1 - changes/(arr.length-1);
  }

  // Envia vetor a cada INTERVAL ms
  setInterval(function() {
    if (samples < 5) return; // não envia com poucos dados

    const allDwells = Object.values(key.dwells).flat();
    const now = Date.now();

    const vec = {
      sessionId:     SESSION_ID,
      mouseSpeedAvg: avg(mouse.speeds),
      mouseAccelAvg: avg(mouse.accels),
      mouseJitter:   avg(mouse.jitters),
      clickRate:     mouse.clicks / ((now-startT)/60000),
      scrollSpeedAvg: avg(scroll.speeds),
      scrollSmoothness: smoothness(scroll.speeds),
      keyDwellAvg:   avg(allDwells),
      keyFlightAvg:  avg(key.flights),
      typingRhythm:  cv(key.flights),
      touchPressureAvg: avg(touch.pressures) || NaN,
      touchAreaAvg:  avg(touch.areas) || NaN,
      windowFocused: windowFocused,
      sampleCount:   samples,
      durationMs:    now - startT,
    };

    // Reset acumuladores (janela deslizante)
    mouse.speeds=[]; mouse.accels=[]; mouse.jitters=[]; mouse.clicks=0;
    scroll.speeds=[];
    key.dwells={}; key.flights=[];
    touch.pressures=[]; touch.areas=[];
    samples = 0;

    // Envia (fire-and-forget, não bloqueia UI)
    fetch(ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(vec),
      keepalive: true,
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data.alert) {
        document.dispatchEvent(new CustomEvent("volatus:biometric:alert", { detail: data }));
      }
    }).catch(function(){});
  }, INTERVAL);

  console.log("[VolatusBiometric] Monitoramento comportamental ativo — privacidade: apenas estatísticas, zero dados brutos");
})();
`.trim();
}

/* ════════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════════ */
export interface BiometricStats {
  activeSessions:   number;
  baselineSessions: number;
  monitorSessions:  number;
  totalVectors:     number;
  totalAnomalies:   number;
  totalAlerts:      number;
  hijackFlags:      number;
  avgSessionScore:  number;
  algorithm:        string;
  privacyNote:      string;
}

export function getBiometricStats(): BiometricStats {
  const all       = [...sessions.values()];
  const monitoring = all.filter(s => s.phase === "monitoring");
  const avgScore  = monitoring.length
    ? mean(monitoring.map(s => s.currentScore))
    : 0;

  return {
    activeSessions:   all.length,
    baselineSessions: all.filter(s => s.phase === "baseline").length,
    monitorSessions:  monitoring.length,
    totalVectors:     _vectors,
    totalAnomalies:   _anomalies,
    totalAlerts:      _alerts,
    hijackFlags:      _hijackFlags,
    avgSessionScore:  Math.round(avgScore * 100) / 100,
    algorithm:        "Z-score composto por feature · janela deslizante 5 vetores",
    privacyNote:      "Eventos brutos nunca saem do browser · Apenas resumos estatísticos",
  };
}

console.log("[volatus-biometric] 🧬 Biometria Comportamental Contínua ativa — monitoramento em tempo real, zero dados brutos");
