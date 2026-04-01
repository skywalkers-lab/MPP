import request from 'supertest';
import express from 'express';
import { RelayServer } from '../src/relay/RelayServer';
import { createViewerApiRouter } from '../src/relay/viewerApi';

describe('Session Notes API', () => {
  let app: express.Express;
  let relayServer: RelayServer;
  const sessionId = 'S-NOTE01';

  beforeEach(() => {
    relayServer = new RelayServer({ wsPort: 0 });
    app = express();
    app.use(express.json());
    app.use('/api/viewer', createViewerApiRouter(relayServer));

    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-note', {
      requestedSessionId: sessionId,
      protocolVersion: 1,
    });
  });

  afterEach(() => {
    relayServer.close();
  });

  it('GET/POST/DELETE notes flow works for a session', async () => {
    let res = await request(app).get(`/api/viewer/notes/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);

    const post = await request(app)
      .post(`/api/viewer/notes/${sessionId}`)
      .send({
        text: 'Lap 12 understeer increased.',
        category: 'incident',
        authorLabel: 'Engineer',
        lap: 12,
      });

    expect(post.status).toBe(201);
    expect(post.body.note.sessionId).toBe(sessionId);
    expect(post.body.note.text).toBe('Lap 12 understeer increased.');

    const noteId = post.body.note.noteId;

    res = await request(app).get(`/api/viewer/notes/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.notes[0].noteId).toBe(noteId);

    const del = await request(app).delete(`/api/viewer/notes/${sessionId}/${noteId}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    res = await request(app).get(`/api/viewer/notes/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('validates request body for text and enum-like fields', async () => {
    let res = await request(app)
      .post(`/api/viewer/notes/${sessionId}`)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_text');

    res = await request(app)
      .post(`/api/viewer/notes/${sessionId}`)
      .send({ text: 'ok', category: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_category');

    res = await request(app)
      .post(`/api/viewer/notes/${sessionId}`)
      .send({ text: 'ok', authorLabel: 'RandomRole' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_author_label');
  });

  it('keeps notes separated by session and supports timeline merge', async () => {
    const ws = { send: jest.fn() } as any;
    (relayServer as any).handleHostHello(ws, 'conn-note-2', {
      requestedSessionId: 'S-NOTE02',
      protocolVersion: 1,
    });

    await request(app)
      .post(`/api/viewer/notes/${sessionId}`)
      .send({ text: 'S1 note', category: 'general', authorLabel: 'Observer' });

    await request(app)
      .post('/api/viewer/notes/S-NOTE02')
      .send({ text: 'S2 note', category: 'strategy', authorLabel: 'Strategist' });

    const s1 = await request(app).get(`/api/viewer/notes/${sessionId}`);
    const s2 = await request(app).get('/api/viewer/notes/S-NOTE02');

    expect(s1.body.notes).toHaveLength(1);
    expect(s2.body.notes).toHaveLength(1);
    expect(s1.body.notes[0].text).toBe('S1 note');
    expect(s2.body.notes[0].text).toBe('S2 note');

    const timeline = await request(app).get(`/api/viewer/timeline/${sessionId}?limit=50`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.timeline.length).toBeGreaterThan(0);
    expect(
      timeline.body.timeline.some((i: any) => i.kind === 'note' && i.note.text === 'S1 note')
    ).toBe(true);
    expect(
      timeline.body.timeline.some((i: any) => i.kind === 'ops_event')
    ).toBe(true);
  });
});
