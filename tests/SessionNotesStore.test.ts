import { InMemorySessionNotesStore } from '../src/relay/notes';

describe('SessionNotesStore', () => {
  it('CRUD and session separation work as expected', () => {
    const store = new InMemorySessionNotesStore();

    const a1 = store.addNote('S-A', {
      text: 'first note',
      category: 'general',
      authorLabel: 'Engineer',
      timestamp: 100,
    });
    const a2 = store.addNote('S-A', {
      text: 'second note',
      category: 'strategy',
      authorLabel: 'Strategist',
      timestamp: 300,
    });
    store.addNote('S-B', {
      text: 'other session',
      category: 'incident',
      authorLabel: 'Observer',
      timestamp: 200,
    });

    const aNotes = store.listNotes('S-A');
    expect(aNotes).toHaveLength(2);
    expect(aNotes[0].noteId).toBe(a1.noteId);
    expect(aNotes[1].noteId).toBe(a2.noteId);

    const bNotes = store.listNotes('S-B');
    expect(bNotes).toHaveLength(1);
    expect(bNotes[0].text).toBe('other session');

    expect(store.getNoteCount('S-A')).toBe(2);
    expect(store.getNoteCount('S-B')).toBe(1);

    const latestA = store.getLatestNote('S-A');
    expect(latestA?.text).toBe('second note');

    const deleted = store.deleteNote('S-A', a1.noteId);
    expect(deleted).toBe(true);
    expect(store.listNotes('S-A')).toHaveLength(1);

    const missingDelete = store.deleteNote('S-A', 'nope');
    expect(missingDelete).toBe(false);
  });

  it('listNotes returns timestamp ascending order', () => {
    const store = new InMemorySessionNotesStore();

    store.addNote('S-T', {
      text: 'ts300',
      timestamp: 300,
      category: 'general',
      authorLabel: 'Engineer',
    });
    store.addNote('S-T', {
      text: 'ts100',
      timestamp: 100,
      category: 'general',
      authorLabel: 'Engineer',
    });
    store.addNote('S-T', {
      text: 'ts200',
      timestamp: 200,
      category: 'general',
      authorLabel: 'Engineer',
    });

    const notes = store.listNotes('S-T');
    expect(notes.map((n) => n.text)).toEqual(['ts100', 'ts200', 'ts300']);
  });

  it('merges notes from rebound alias session into canonical session', () => {
    const store = new InMemorySessionNotesStore();

    store.addNote('S-CANON', {
      text: 'canon-1',
      timestamp: 200,
      category: 'general',
      authorLabel: 'Engineer',
    });

    store.addNote('S-ALIAS', {
      text: 'alias-1',
      timestamp: 100,
      category: 'strategy',
      authorLabel: 'Strategist',
    });

    store.mergeSessions('S-ALIAS', 'S-CANON');

    expect(store.getNoteCount('S-ALIAS')).toBe(0);
    const merged = store.listNotes('S-CANON');
    expect(merged).toHaveLength(2);
    expect(merged.map((note) => note.text)).toEqual(['alias-1', 'canon-1']);
    expect(merged.every((note) => note.sessionId === 'S-CANON')).toBe(true);
  });
});
