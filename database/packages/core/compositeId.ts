export const encodeCompositeId = (parts: Array<string | number | boolean>): string =>
  parts.map((part) => encodeURIComponent(String(part))).join(':');

export const decodeCompositeId = (value: string, expectedParts: number): string[] => {
  const parts = value.split(':');
  if (parts.length !== expectedParts) {
    throw new Error('Invalid composite identifier');
  }
  return parts.map((part) => decodeURIComponent(part));
};

export const encodeCompositeIdFromRecord = (
  primaryKeys: string[],
  record: Record<string, unknown>
): string | null => {
  const parts: Array<string | number | boolean> = [];
  for (const key of primaryKeys) {
    const value = record[key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return null;
    }
    parts.push(value);
  }
  return encodeCompositeId(parts);
};
