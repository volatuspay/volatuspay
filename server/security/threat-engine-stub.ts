/**
 * Stub do threat-engine — mantém compatibilidade com os módulos VolatusShield
 * que chamam recordThreatEvent / getIpRecord sem dependência externa.
 */

export function recordThreatEvent(
  _ip: string,
  _eventType: string,
  _meta?: Record<string, unknown>
): void {
  // no-op: integração futura com threat-engine completo
}

export function getIpRecord(_ip: string): null {
  return null;
}

export function trackCanaryHit(
  _token: string,
  _ip: string,
  _sessionId: string | null
): void {
  // no-op
}

export function kc3Observe(_event: Record<string, unknown>): void {
  // no-op
}
