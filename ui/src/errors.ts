export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 240 ? `${error.message.slice(0, 237)}…` : error.message;
  }
  return String(error);
}
