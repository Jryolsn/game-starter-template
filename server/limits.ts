// Enkla gränser mot missbruk. Värdena går att ändra med miljövariabler.

/** Token bucket: tillåter `burst` meddelanden direkt och fyller på med `perSecond`. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private perSecond: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

/** Räknar händelser per nyckel (t.ex. IP-adress) inom ett glidande fönster. */
export class WindowCounter {
  private hits = new Map<string, number[]>();

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Har nyckeln nått taket inom fönstret? (räknar inte som en ny händelse) */
  isBlocked(key: string, now = Date.now()): boolean {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length >= this.max;
  }

  /** Rensa gamla nycklar så att kartan inte växer för evigt. */
  prune(now = Date.now()): void {
    for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const LIMITS = {
  /** Meddelanden per sekund och anslutning (input skickas bara vid ändring, så 30 räcker gott). */
  msgPerSecond: num("LIMIT_MSG_PER_SECOND", 30),
  msgBurst: num("LIMIT_MSG_BURST", 60),
  /** Rum som en IP-adress får skapa per minut. */
  roomsPerMinute: num("LIMIT_ROOMS_PER_MINUTE", 10),
  /** Felaktiga rumskoder per IP och minut innan fler försök stoppas. */
  failedJoinsPerMinute: num("LIMIT_FAILED_JOINS_PER_MINUTE", 20),
  /** Max antal rum totalt på servern. */
  maxRooms: num("LIMIT_MAX_ROOMS", 1000),
  /** Max samtidiga anslutningar per IP-adress. */
  connectionsPerIp: num("LIMIT_CONNECTIONS_PER_IP", 20),
  /** Felrapporter från webbläsare per IP och minut (POST /log). */
  clientErrorsPerMinute: num("LIMIT_CLIENT_ERRORS_PER_MINUTE", 10),
};
