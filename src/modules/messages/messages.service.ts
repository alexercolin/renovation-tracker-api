import { type Db } from '../../db/client.js';
import { type Actor } from '../../shared/actor.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
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
    if (inserted) return toMessage(inserted);

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

  async listJobMessages(jobId: string, page: MessagePageQuery): Promise<Message[]> {
    const rows = await this.messagesRepository.listPage(this.db, jobId, page);
    return rows.map(toMessage);
  }
}
