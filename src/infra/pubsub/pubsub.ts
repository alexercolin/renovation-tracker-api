import { createPubSub, type PubSub } from 'graphql-yoga';

export interface MessageAddedEvent {
  messageId: string;
}

export interface ReportUpdatedEvent {
  reportId: string;
}

export type RealtimeTopics = {
  messageAdded: [jobId: string, payload: MessageAddedEvent];
  reportUpdated: [reportId: string, payload: ReportUpdatedEvent];
};

export type RealtimePubSub = PubSub<RealtimeTopics>;

export function createInMemoryPubSub(): RealtimePubSub {
  return createPubSub<RealtimeTopics>();
}
