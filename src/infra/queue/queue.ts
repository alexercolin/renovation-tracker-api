export interface QueueMessage {
  id: string;
  receiptHandle: string;
  body: string;
}

export interface ReceiveOptions {
  maxMessages: number;
  waitSeconds: number;
  signal?: AbortSignal;
}

export interface MessageQueue {
  send(body: string): Promise<void>;
  receive(options: ReceiveOptions): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
}
