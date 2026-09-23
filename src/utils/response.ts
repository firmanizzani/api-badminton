export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export const ok = <T>(data: T) => ({ success: true as const, data });

export const fail = (message: string, code = "ERROR") =>
  ({ success: false as const, message, code }) as const;

export const notFound = (message = "Data tidak ditemukan", code = "NOT_FOUND") =>
  new AppError(404, code, message);
