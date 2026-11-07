import type { ChatMessage } from '../../types.ts';
import { type Db, newId, nowIso, table } from '../db.ts';

const t = table<ChatMessage>('chat_messages');

export function append(db: Db, role: ChatMessage['role'], text: string): ChatMessage {
  return t.insert(db, { id: newId('msg'), role, text, at: nowIso() });
}
export function list(db: Db, limit: number): ChatMessage[] {
  return t.select(db, 'ORDER BY rowid DESC LIMIT ?', limit).reverse();
}
