type StoredMessage = Record<string, unknown>;

const threads = new Map<string, StoredMessage[]>();

export function getThreadMessages(threadId: string) {
  return structuredClone(threads.get(threadId) ?? []);
}

export function saveThreadMessages(threadId: string, messages: StoredMessage[]) {
  threads.set(threadId, structuredClone(messages));
}
