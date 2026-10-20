import type { PluginErrorPayload } from '@owox/plugin-sdk';

function isPayload(value: unknown): value is PluginErrorPayload {
  if (typeof value !== 'object' || value === null) return false;
  return 'code' in value && 'message' in value && typeof value.message === 'string';
}

export function describeError(error: unknown): string {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (
      current.name === 'PluginTransportError' &&
      'payload' in current &&
      isPayload(current.payload)
    ) {
      const { code, status, message } = current.payload;
      return [code, status, message].filter(part => part !== undefined && part !== '').join(' ');
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}
