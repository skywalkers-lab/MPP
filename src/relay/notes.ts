import { v4 as uuidv4 } from 'uuid';

export const NOTE_MAX_TEXT_LENGTH = 400;
export const NOTE_ALLOWED_CATEGORIES = ['general', 'incident', 'strategy', 'pit', 'risk'] as const;
export const NOTE_ALLOWED_AUTHOR_LABELS = ['Engineer', 'Strategist', 'Pit Wall', 'Observer'] as const;
export const NOTE_ALLOWED_SEVERITIES = ['low', 'medium', 'high'] as const;

export type SessionNoteCategory = (typeof NOTE_ALLOWED_CATEGORIES)[number];
export type SessionNoteAuthorLabel = (typeof NOTE_ALLOWED_AUTHOR_LABELS)[number];
export type SessionNoteSeverity = (typeof NOTE_ALLOWED_SEVERITIES)[number];

export interface SessionNote {
  noteId: string;
  sessionId: string;
  timestamp: number;
  createdAt: number;
  category: SessionNoteCategory;
  text: string;
  authorLabel: SessionNoteAuthorLabel;
  lap?: number;
  tag?: string;
  severity?: SessionNoteSeverity;
}

export interface AddSessionNoteInput {
  timestamp?: number;
  category?: SessionNoteCategory;
  text: string;
  authorLabel?: SessionNoteAuthorLabel;
  lap?: number;
  tag?: string;
  severity?: SessionNoteSeverity;
}

export interface SessionNotesStore {
  listNotes(sessionId: string): SessionNote[];
  addNote(sessionId: string, payload: AddSessionNoteInput): SessionNote;
  deleteNote(sessionId: string, noteId: string): boolean;
  getNoteCount(sessionId: string): number;
  getLatestNote(sessionId: string): SessionNote | null;
  mergeSessions(fromSessionId: string, toSessionId: string): void;
}

export class InMemorySessionNotesStore implements SessionNotesStore {
  private readonly notesBySession = new Map<string, SessionNote[]>();

  listNotes(sessionId: string): SessionNote[] {
    const notes = this.notesBySession.get(sessionId) ?? [];
    return [...notes].sort((a, b) => a.timestamp - b.timestamp);
  }

  addNote(sessionId: string, payload: AddSessionNoteInput): SessionNote {
    const now = Date.now();
    const note: SessionNote = {
      noteId: `note-${uuidv4()}`,
      sessionId,
      timestamp: payload.timestamp ?? now,
      createdAt: now,
      category: payload.category ?? 'general',
      text: payload.text,
      authorLabel: payload.authorLabel ?? 'Engineer',
      lap: payload.lap,
      tag: payload.tag,
      severity: payload.severity,
    };

    const notes = this.notesBySession.get(sessionId) ?? [];
    notes.push(note);
    this.notesBySession.set(sessionId, notes);

    return note;
  }

  deleteNote(sessionId: string, noteId: string): boolean {
    const notes = this.notesBySession.get(sessionId);
    if (!notes || notes.length === 0) return false;

    const idx = notes.findIndex((n) => n.noteId === noteId);
    if (idx < 0) return false;

    notes.splice(idx, 1);
    if (notes.length === 0) {
      this.notesBySession.delete(sessionId);
    }

    return true;
  }

  getNoteCount(sessionId: string): number {
    return this.notesBySession.get(sessionId)?.length ?? 0;
  }

  getLatestNote(sessionId: string): SessionNote | null {
    const notes = this.notesBySession.get(sessionId);
    if (!notes || notes.length === 0) return null;

    let latest = notes[0];
    for (const note of notes) {
      if (note.timestamp > latest.timestamp) {
        latest = note;
      }
    }
    return latest;
  }

  mergeSessions(fromSessionId: string, toSessionId: string): void {
    if (fromSessionId === toSessionId) {
      return;
    }

    const source = this.notesBySession.get(fromSessionId);
    if (!source || source.length === 0) {
      return;
    }

    const target = this.notesBySession.get(toSessionId) ?? [];
    const merged: SessionNote[] = [
      ...target,
      ...source.map((note) => ({
        ...note,
        sessionId: toSessionId,
      })),
    ];

    merged.sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.createdAt - b.createdAt;
    });

    this.notesBySession.set(toSessionId, merged);
    this.notesBySession.delete(fromSessionId);
  }
}
