export function logInfo(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

export function logWarn(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "warn", event, ...data }));
}

export function logError(
  message: string,
  data: Record<string, unknown> = {},
): void {
  console.error(JSON.stringify({ level: "error", message, ...data }));
}
