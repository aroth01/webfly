// SCDS connection over Solace (solclientjs). Loaded only when SWIM_ENABLED=true.
import type solaceNs from 'solclientjs';
import type { SwimTransport, TransportHandlers } from './consumer.ts';

type Solace = typeof solaceNs;

export interface ScdsConfig {
  url: string; // e.g. tcps://ems1.swim.faa.gov:55443
  vpn: string;
  username: string;
  password: string;
  queue: string;
}

/** The parts of a Solace message payloadOf reads. */
export interface SolaceMessageLike {
  getXmlContentDecoded(): string | null;
  getType(): unknown;
  getSdtContainer(): { getValue(): unknown } | null;
  getBinaryAttachment(): Uint8Array | string | null;
}

const utf8 = new TextDecoder();

/**
 * The XML text of a message. SCDS delivers JMS text messages, which Solace puts in the XML-content
 * part by default; fall back to an SDT text payload, then to a binary attachment.
 */
export function payloadOf(m: SolaceMessageLike, textType: unknown): string | null {
  const xml = m.getXmlContentDecoded();
  if (xml) return xml;
  if (m.getType() === textType) {
    const v = m.getSdtContainer()?.getValue();
    if (typeof v === 'string') return v;
  }
  const b = m.getBinaryAttachment();
  if (b === null || b === undefined) return null;
  return typeof b === 'string' ? Buffer.from(b, 'latin1').toString('utf8') : utf8.decode(b);
}

class SolaceTransport implements SwimTransport {
  private readonly solace: Solace;
  private readonly cfg: ScdsConfig;
  private session: solaceNs.Session | undefined;
  private consumer: solaceNs.MessageConsumer | undefined;
  private down = false;

  constructor(solace: Solace, cfg: ScdsConfig) {
    this.solace = solace;
    this.cfg = cfg;
  }

  connect(h: TransportHandlers): void {
    const s = this.solace;
    const fail = (reason: string) => {
      if (this.down) return;
      this.down = true;
      h.onDown(reason);
    };
    try {
      // Reconnects are SwimConsumer's job (with its own backoff), so the session doesn't retry.
      const session = s.SolclientFactory.createSession({
        url: this.cfg.url,
        vpnName: this.cfg.vpn,
        userName: this.cfg.username,
        password: this.cfg.password,
        connectRetries: 0,
        reconnectRetries: 0,
        connectTimeoutInMsecs: 15_000,
      });
      this.session = session;
      session.on(s.SessionEventCode.UP_NOTICE, () => {
        const consumer = session.createMessageConsumer({
          queueDescriptor: { name: this.cfg.queue, type: s.QueueType.QUEUE },
          acknowledgeMode: s.MessageConsumerAcknowledgeMode.CLIENT,
          windowSize: 255,
        });
        this.consumer = consumer;
        consumer.on(s.MessageConsumerEventName.UP, () => h.onUp());
        consumer.on(s.MessageConsumerEventName.CONNECT_FAILED_ERROR, (e: { message: string }) => fail(`queue bind failed: ${e.message}`));
        consumer.on(s.MessageConsumerEventName.DOWN, () => fail('queue consumer down'));
        consumer.on(s.MessageConsumerEventName.DOWN_ERROR, (e: { message: string }) => fail(`queue consumer error: ${e.message}`));
        consumer.on(s.MessageConsumerEventName.MESSAGE, (m: solaceNs.Message) => h.onMessage(payloadOf(m, s.MessageType.TEXT), () => m.acknowledge()));
        consumer.connect();
      });
      session.on(s.SessionEventCode.CONNECT_FAILED_ERROR, (e: { message: string }) => fail(`connect failed: ${e.message}`));
      session.on(s.SessionEventCode.DOWN_ERROR, (e: { message: string }) => fail(`session error: ${e.message}`));
      session.on(s.SessionEventCode.DISCONNECTED, () => fail('disconnected'));
      session.connect();
    } catch (err) {
      fail(`session setup failed: ${(err as Error).message}`);
    }
  }

  dispose(): void {
    this.down = true;
    try {
      this.consumer?.dispose();
    } catch {
      // already gone
    }
    try {
      this.session?.dispose();
    } catch {
      // already gone
    }
  }
}

/** Initialise solclientjs once and return a factory of connection attempts. */
export async function solaceTransportFactory(cfg: ScdsConfig): Promise<() => SwimTransport> {
  const solace = (await import('solclientjs')).default;
  const props = new solace.SolclientFactoryProperties();
  props.profile = solace.SolclientFactoryProfiles.version10_5;
  props.logLevel = solace.LogLevel.WARN;
  solace.SolclientFactory.init(props);
  return () => new SolaceTransport(solace, cfg);
}
