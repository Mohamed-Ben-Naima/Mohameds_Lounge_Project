// The founder's line to the CEO. Each message becomes a CEO chat run; the reply lands in the chat.
import type { Db } from '../db/db.ts';
import * as chat from '../db/repos/chat.ts';
import type { EventBus } from '../events/bus.ts';
import type { RunQueue } from '../orchestrator/queue.ts';
import type { ChatMessage } from '../types.ts';

export class ChatService {
  private readonly db: Db;
  private readonly bus: EventBus;
  private readonly queue: RunQueue;
  private readonly onEnqueued: () => void;

  constructor(db: Db, bus: EventBus, queue: RunQueue, onEnqueued: () => void) {
    this.db = db;
    this.bus = bus;
    this.queue = queue;
    this.onEnqueued = onEnqueued;
  }

  send(text: string): ChatMessage {
    const message = chat.append(this.db, 'founder', text);
    this.bus.emit({ type: 'chat.message', message });
    this.queue.enqueue({ agentId: 'ceo', purpose: 'chat', payload: { text } });
    this.onEnqueued();
    return message;
  }

  list(limit = 200): ChatMessage[] {
    return chat.list(this.db, limit);
  }
}
