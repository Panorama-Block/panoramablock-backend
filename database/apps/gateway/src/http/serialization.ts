import { entityConfigByCollection } from '../../../../packages/core/entities.js';
import { encodeCompositeIdFromRecord } from '../../../../packages/core/compositeId.js';

const normalizeCompositeRecord = (
  entity: string,
  record: Record<string, any>
): Record<string, any> => {
  const config = entityConfigByCollection[entity];
  if (!config || config.primaryKeys.length <= 1) {
    return record;
  }

  const canonicalId = encodeCompositeIdFromRecord(config.primaryKeys, record);
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

  return normalizeCompositeRecord(entity, record);
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
