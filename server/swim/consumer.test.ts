import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlightStore } from '../store/flights.ts';
import { SwimConsumer, type SwimTransport, type TransportHandlers } from './consumer.ts';
import { SwimIngest } from './ingest.ts';
import { payloadOf, solaceTransportFactory } from './solace.ts';

const FH = readFileSync(new URL('./fixtures/synthetic/01-FH-AAL558.xml', import.meta.url), 'utf8');

class FakeTransport implements SwimTransport {
  handlers: TransportHandlers | undefined;
  disposed = false;
  connect(h: TransportHandlers): void {
    this.handlers = h;
  }
  dispose(): void {
    this.disposed = true;
  }
}

function setup() {
  let now = 1_000_000;
  const transports: FakeTransport[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const store = new FlightStore(':memory:');
  const ingest = new SwimIngest(store, () => now);
  const recorded: string[] = [];
  const consumer = new SwimConsumer({
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    ingest,
    now: () => now,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return () => {};
    },
    record: (p) => recorded.push(p),
    log: () => {},
  });
  const fireTimer = () => (timers.shift() as { fn: () => void }).fn();
  return { consumer, transports, timers, fireTimer, store, recorded, advance: (ms: number) => (now += ms) };
}

describe('SwimConsumer', () => {
  it('ingests and acknowledges every message, including ones it cannot parse', () => {
    const { consumer, transports, store, recorded } = setup();
    consumer.start();
    const h = transports[0]!.handlers!;
    h.onUp();
    let acks = 0;
    h.onMessage(FH, () => acks++);
    h.onMessage('garbage source="FH"', () => acks++);
    h.onMessage(null, () => acks++);
    expect(acks).toBe(3);
    expect(store.byCallsigns(['AAL558'])).toHaveLength(1);
    expect(recorded).toEqual([FH]);
    expect(consumer.status()).toMatchObject({ enabled: true, connected: true, keptPerMin: 1, droppedPerMin: 1, lastMessageAt: 1_000_000, reconnects: 0 });
  });

  it('reconnects with 1 s doubling to 60 s, and resets after a stable connection', () => {
    const { consumer, transports, timers, fireTimer, advance } = setup();
    consumer.start();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      transports.at(-1)!.handlers!.onDown('connect failed');
      waits.push(timers[0]!.ms);
      fireTimer();
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    expect(transports.slice(0, -1).every((t) => t.disposed)).toBe(true);
    expect(consumer.status()).toMatchObject({ connected: false, reconnects: 8 });

    transports.at(-1)!.handlers!.onUp();
    advance(120_000);
    transports.at(-1)!.handlers!.onDown('disconnected');
    expect(timers[0]!.ms).toBe(1_000);
  });

  it('ignores events from a connection it has already given up on, and stops cleanly', () => {
    const { consumer, transports, timers } = setup();
    consumer.start();
    const first = transports[0]!.handlers!;
    first.onDown('disconnected');
    first.onDown('disconnected again');
    first.onUp();
    expect(timers).toHaveLength(1);
    expect(consumer.status().connected).toBe(false);
    consumer.stop();
    expect(transports[0]!.disposed).toBe(true);
  });
});

describe('payloadOf', () => {
  const msg = (xml: string | null, type: number, sdt: unknown, bin: Uint8Array | string | null) => ({
    getXmlContentDecoded: () => xml,
    getType: () => type,
    getSdtContainer: () => (sdt === undefined ? null : { getValue: () => sdt }),
    getBinaryAttachment: () => bin,
  });

  it('reads the XML content part, then SDT text, then a binary attachment', () => {
    expect(payloadOf(msg('<a/>', 0, undefined, null), 3)).toBe('<a/>');
    expect(payloadOf(msg(null, 3, '<b/>', null), 3)).toBe('<b/>');
    expect(payloadOf(msg(null, 0, undefined, new TextEncoder().encode('<c>é</c>')), 3)).toBe('<c>é</c>');
    expect(payloadOf(msg(null, 0, undefined, Buffer.from('<d>é</d>').toString('latin1')), 3)).toBe('<d>é</d>');
    expect(payloadOf(msg(null, 0, undefined, null), 3)).toBeNull();
  });
});

describe('solaceTransportFactory', () => {
  it('loads solclientjs and returns a transport factory without connecting', async () => {
    const create = await solaceTransportFactory({ url: 'tcps://localhost:1', vpn: 'v', username: 'u', password: 'p', queue: 'q' });
    const t = create();
    expect(typeof t.connect).toBe('function');
    t.dispose();
  });
});
