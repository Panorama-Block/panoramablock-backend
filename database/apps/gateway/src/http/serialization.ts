const canonicalConversationId = (record: Record<string, any>): string | null => {
  const userId = typeof record.userId === 'string' ? record.userId : null;
  const conversationId = typeof record.conversationId === 'string' ? record.conversationId : null;
  if (!userId || !conversationId) {
    return null;
  }
  return `${userId}:${conversationId}`;
};

const normalizeConversationRecord = (record: Record<string, any>): Record<string, any> => {
  const canonicalId = canonicalConversationId(record);
  if (!canonicalId) {
    return record;
  }
  return {
    ...record,
    id: canonicalId
  };
};

export const normalizeGatewayRecord = (entity: string, record: any): any => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }

  if (entity === 'conversations') {
    return normalizeConversationRecord(record);
  }

  return record;
};

export const normalizeGatewayListResponse = (entity: string, response: any): any => {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return response;
  }

  if (!Array.isArray(response.data)) {
    return response;
  }

  return {
    ...response,
    data: response.data.map((item: any) => normalizeGatewayRecord(entity, item))
  };
};

