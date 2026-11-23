/** Latency/throughput accounting for the load generator (reservoir-sampled percentiles). */

export interface StatSummary {
  count: number;
  errors: number;
  rate: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  codes: Record<string, number>;
}

export class Stat {
  count = 0;
  errors = 0;
  private sum = 0;
  private max = 0;
  private seen = 0;
  private readonly samples: number[] = [];
  readonly codes = new Map<string, number>();

  constructor(private readonly cap = 200_000) {}

  record(ms: number): void {
    this.count += 1;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
    this.seen += 1;
    if (this.samples.length < this.cap) this.samples.push(ms);
    else {
      const j = Math.floor(Math.random() * this.seen);
      if (j < this.cap) this.samples[j] = ms;
    }
  }

  error(code: string): void {
    this.errors += 1;
    this.codes.set(code, (this.codes.get(code) ?? 0) + 1);
  }

  summary(elapsedSec: number): StatSummary {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0;
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      count: this.count,
      errors: this.errors,
      rate: round((this.count + this.errors) / Math.max(1, elapsedSec)),
      mean: round(this.count ? this.sum / this.count : 0),
      p50: round(pct(50)),
      p90: round(pct(90)),
      p95: round(pct(95)),
      p99: round(pct(99)),
      max: round(this.max),
      codes: Object.fromEntries(this.codes),
    };
  }
}

export class Metrics {
  readonly stats = new Map<string, Stat>();
  readonly counters = new Map<string, number>();
  readonly gauges = new Map<string, number>();

  stat(name: string): Stat {
    let s = this.stats.get(name);
    if (!s) {
      s = new Stat();
      this.stats.set(name, s);
    }
    return s;
  }

  inc(name: string, n = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  gauge(name: string, v: number): void {
    this.gauges.set(name, v);
  }

  snapshot(elapsedSec: number) {
    return {
      elapsedSec: Math.round(elapsedSec),
      ops: Object.fromEntries(
        [...this.stats.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, s]) => [k, s.summary(elapsedSec)]),
      ),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
