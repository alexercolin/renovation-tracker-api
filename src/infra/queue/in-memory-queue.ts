import { type MessageQueue, type QueueMessage, type ReceiveOptions } from './queue.js';

export class InMemoryQueue implements MessageQueue {
  readonly pending: QueueMessage[] = [];
  readonly inFlight = new Map<string, QueueMessage>();
  sendError: Error | undefined;
  private counter = 0;

  send(body: string): Promise<void> {
    if (this.sendError) return Promise.reject(this.sendError);
    this.counter += 1;
    const id = `msg-${this.counter}`;
    this.pending.push({ id, receiptHandle: `receipt-${id}`, body });
    return Promise.resolve();
  }

  receive({ maxMessages }: ReceiveOptions): Promise<QueueMessage[]> {
    const batch = this.pending.splice(0, maxMessages);
    for (const message of batch) this.inFlight.set(message.receiptHandle, message);
    return Promise.resolve(batch);
  }

  delete(receiptHandle: string): Promise<void> {
    this.inFlight.delete(receiptHandle);
    return Promise.resolve();
  }

  releaseInFlight(): void {
    for (const message of this.inFlight.values()) this.pending.push(message);
    this.inFlight.clear();
  }
}
