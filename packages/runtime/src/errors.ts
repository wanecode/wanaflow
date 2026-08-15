export class RuntimeProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly elementId?: string,
  ) {
    super(message);
    this.name = "RuntimeProfileError";
  }
}

export class RuntimeAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeAdapterError";
  }
}
