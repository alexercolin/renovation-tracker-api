import { type Db } from '../../db/client.js';
import { type MessageAddedEvent, type RealtimePubSub } from '../../infra/pubsub/pubsub.js';
import { type Actor } from '../../shared/actor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { parseId } from '../../shared/ids.js';
import { type JobsService } from '../jobs/jobs.service.js';
import { type MessagesRepository } from './messages.repository.js';
import {
  type Message,
  type MessagePageQuery,
  sendMessageInputSchema,
  toMessage,
} from './messages.types.js';

export class MessagesService {
  constructor(
    private readonly db: Db,
    private readonly messagesRepository: MessagesRepository,
    private readonly jobsService: JobsService,
    private readonly pubsub: RealtimePubSub,
  ) {}

  async sendMessage(actor: Actor, input: unknown): Promise<Message> {
    const parsed = sendMessageInputSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);
    const { jobId, body, clientMessageId } = parsed.data;

    const job = await this.jobsService.getJob(actor, jobId);
    if (job.deletedAt) throw new ConflictError('Job is deleted', { id: job.id });

    const inserted = await this.messagesRepository.insert(this.db, {
      jobId: job.id,
      senderId: actor.id,
      body,
      clientMessageId,
    });
    if (inserted) {
      this.pubsub.publish('messageAdded', job.id, { messageId: inserted.id });
      return toMessage(inserted);
    }

    const existing = clientMessageId
      ? await this.messagesRepository.findByClientMessageId(this.db, actor.id, clientMessageId)
      : undefined;
    if (!existing) throw new ConflictError('Message could not be stored');
    if (existing.jobId !== job.id) {
      throw new ConflictError('clientMessageId was already used for another job', {
        clientMessageId,
      });
    }
    return toMessage(existing);
  }

  async getMessageById(id: string): Promise<Message> {
    const row = await this.messagesRepository.findById(this.db, id);
    if (!row) throw new NotFoundError('Message', id);
    return toMessage(row);
  }

  async subscribeToJob(actor: Actor, id: string): Promise<AsyncIterable<MessageAddedEvent>> {
    const job = await this.jobsService.getJob(actor, parseId(id, 'jobId'));
    return this.pubsub.subscribe('messageAdded', job.id);
  }

  async listJobMessages(jobId: string, page: MessagePageQuery): Promise<Message[]> {
    const rows = await this.messagesRepository.listPage(this.db, jobId, page);
    return rows.map(toMessage);
  }
}
