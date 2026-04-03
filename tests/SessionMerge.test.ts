import { RelayServer } from '../src/relay/RelayServer';
import express from 'express';
import request from 'supertest';
import { createViewerApiRouter } from '../src/relay/viewerApi';

describe('Relay telemetry session merge', () => {
  function sharedState() {
    return {
      sessionMeta: { sessionUID: 'UID-SHARED-RACE', totalLaps: 58, currentLap: 9 },
      playerCarIndex: 0,
      spectatorCarIndex: null,
      cars: {
        0: {
          carIndex: 0,
          position: 4,
          currentLapNum: 9,
          tyreAgeLaps: 10,
          fuelLapsRemaining: 19,
          tyreCompound: 'M',
        },
      },
      drivers: {},
      eventLog: [],
    } as any;
  }

  it('merges near-concurrent hosts into one canonical session when telemetry sessionUID matches', () => {
    const relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 2000 });
    const ws1 = { send: jest.fn() } as any;
    const ws2 = { send: jest.fn() } as any;

    (relayServer as any).handleHostHello(ws1, 'conn-a', {
      requestedSessionId: 'S-A11111',
      protocolVersion: 1,
    });
    (relayServer as any).handleHostHello(ws2, 'conn-b', {
      requestedSessionId: 'S-B22222',
      protocolVersion: 1,
    });

    (relayServer as any).connToWs.set('conn-a', ws1);
    (relayServer as any).connToWs.set('conn-b', ws2);

    (relayServer as any).handleStateSnapshot('conn-a', {
      type: 'state_snapshot',
      sessionId: 'S-A11111',
      sequence: 1,
      timestamp: Date.now(),
      state: sharedState(),
    });
    (relayServer as any).handleStateSnapshot('conn-b', {
      type: 'state_snapshot',
      sessionId: 'S-B22222',
      sequence: 1,
      timestamp: Date.now(),
      state: sharedState(),
    });

    const summaries = relayServer.listSessionOpsSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].sessionId).toBe('S-A11111');
    expect((relayServer as any).connToSession.get('conn-b')).toBe('S-A11111');
    expect(ws2.send).toHaveBeenCalledWith(expect.stringContaining('"type":"session_rebound"'));

    relayServer.close();
  });

  it('keeps session active when one merged connection closes but another remains active', () => {
    const relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 2000 });
    const ws1 = { send: jest.fn() } as any;
    const ws2 = { send: jest.fn() } as any;

    (relayServer as any).handleHostHello(ws1, 'conn-a', {
      requestedSessionId: 'S-ACTIVE1',
      protocolVersion: 1,
    });
    (relayServer as any).handleHostHello(ws2, 'conn-b', {
      requestedSessionId: 'S-ACTIVE2',
      protocolVersion: 1,
    });

    (relayServer as any).connToWs.set('conn-a', ws1);
    (relayServer as any).connToWs.set('conn-b', ws2);

    (relayServer as any).handleStateSnapshot('conn-a', {
      type: 'state_snapshot',
      sessionId: 'S-ACTIVE1',
      sequence: 1,
      timestamp: Date.now(),
      state: sharedState(),
    });
    (relayServer as any).handleStateSnapshot('conn-b', {
      type: 'state_snapshot',
      sessionId: 'S-ACTIVE2',
      sequence: 1,
      timestamp: Date.now(),
      state: sharedState(),
    });

    (relayServer as any).handleClose('conn-b');

    const canonical = relayServer.getSession('S-ACTIVE1');
    expect(canonical?.status).toBe('active');

    relayServer.close();
  });

  it('preserves old joinCode access and canonical archive timeline keeps rebound context', async () => {
    const relayServer = new RelayServer({ wsPort: 0, heartbeatTimeoutMs: 2000 });
    const app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws1 = { send: jest.fn() } as any;
    const ws2 = { send: jest.fn() } as any;

    (relayServer as any).handleHostHello(ws1, 'conn-a', {
      requestedSessionId: 'S-JOINA1',
      protocolVersion: 1,
    });
    (relayServer as any).handleHostHello(ws2, 'conn-b', {
      requestedSessionId: 'S-JOINB2',
      protocolVersion: 1,
    });

    const accessB = relayServer.getSessionAccess('S-JOINB2');
    expect(accessB).toBeDefined();

    try {
      await request(app)
        .patch('/api/viewer/session-access/S-JOINA1')
        .send({ shareEnabled: true, visibility: 'code' })
        .expect(200);

      await request(app)
        .patch('/api/viewer/session-access/S-JOINB2')
        .send({ shareEnabled: true, visibility: 'code' })
        .expect(200);

      (relayServer as any).connToWs.set('conn-a', ws1);
      (relayServer as any).connToWs.set('conn-b', ws2);

      (relayServer as any).handleStateSnapshot('conn-a', {
        type: 'state_snapshot',
        sessionId: 'S-JOINA1',
        sequence: 1,
        timestamp: 1000,
        state: sharedState(),
      });
      (relayServer as any).handleStateSnapshot('conn-b', {
        type: 'state_snapshot',
        sessionId: 'S-JOINB2',
        sequence: 1,
        timestamp: 1100,
        state: sharedState(),
      });

      const joinRes = await request(app).get('/api/viewer/join/' + encodeURIComponent(accessB!.joinCode));
      expect(joinRes.status).toBe(200);
      expect(joinRes.body.sessionId).toBe('S-JOINA1');

      (relayServer as any).handleClose('conn-a');
      (relayServer as any).handleClose('conn-b');

      const timeline = relayServer.getSessionArchiveTimeline('S-JOINA1', 200);
      expect(timeline.some((i: any) => i.kind === 'ops_event' && i.event && i.event.type === 'session_rebound')).toBe(true);
      const aliasSummary = relayServer.getSessionArchiveSummary('S-JOINB2');
      const canonicalSummary = relayServer.getSessionArchiveSummary('S-JOINA1');
      expect(aliasSummary).toBeDefined();
      expect(canonicalSummary).toBeDefined();
      expect(aliasSummary?.sessionId).toBe('S-JOINA1');
    } finally {
      relayServer.close();
    }
  });
});
