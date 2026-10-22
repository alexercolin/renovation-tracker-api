import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

import { type MessageQueue, type QueueMessage, type ReceiveOptions } from './queue.js';

export class SqsQueue implements MessageQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async send(body: string): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: body }));
  }

  async receive({ maxMessages, waitSeconds, signal }: ReceiveOptions): Promise<QueueMessage[]> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitSeconds,
      }),
      { abortSignal: signal },
    );
    return (result.Messages ?? []).flatMap((message) =>
      message.MessageId && message.ReceiptHandle && message.Body !== undefined
        ? [{ id: message.MessageId, receiptHandle: message.ReceiptHandle, body: message.Body }]
        : [],
    );
  }

  async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }
}
