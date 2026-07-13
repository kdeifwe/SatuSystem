export type GeminiSchema = Record<string, unknown>;

export function buildGeminiObjectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): GeminiSchema {
  return {
    type: 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
  };
}
