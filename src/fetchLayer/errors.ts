// src/fetchLayer/errors.ts
//
// Typed error classes for the fetch layer. Every error carries a `kind`
// discriminator so the UI can branch on category without instanceof checks
// against subclasses.

export type ErrorKind =
  | "auth"
  | "network"
  | "conflict"
  | "size-limit"
  | "not-found"
  | "unknown";

export class FetchLayerError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 / 403 with an auth-related body. Token invalid, expired, or lacks scope. */
export class AuthError extends FetchLayerError {
  constructor(message: string) {
    super("auth", message);
  }
}

/** Network failure — DNS, offline, CORS, timeout. */
export class NetworkError extends FetchLayerError {
  constructor(message: string) {
    super("network", message);
  }
}

/** 409 or 412 — remote changed since our last known SHA. */
export class ConflictError extends FetchLayerError {
  readonly remoteSha: string | undefined;

  constructor(message: string, remoteSha?: string) {
    super("conflict", message);
    this.remoteSha = remoteSha;
  }
}

/** File exceeds the size ceiling for this client. */
export class SizeLimitError extends FetchLayerError {
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number) {
    super(
      "size-limit",
      `File is ${actualBytes} bytes, exceeds limit of ${limitBytes} bytes`,
    );
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** 404 — repo, path, or ref not found. */
export class NotFoundError extends FetchLayerError {
  constructor(message: string) {
    super("not-found", message);
  }
}