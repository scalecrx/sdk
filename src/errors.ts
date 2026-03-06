import { AnchorError, translateError } from "@coral-xyz/anchor";

export class ScaleSdkError extends Error {
  readonly context: string;
  readonly cause: unknown;
  readonly logs?: string[];
  readonly code?: string;
  readonly number?: number;

  constructor(message: string, context: string, cause: unknown, details?: {
    logs?: string[];
    code?: string;
    number?: number;
  }) {
    super(message);
    this.name = "ScaleSdkError";
    this.context = context;
    this.cause = cause;
    this.logs = details?.logs;
    this.code = details?.code;
    this.number = details?.number;
  }
}

export const toSdkError = (
  context: string,
  err: unknown,
  idlErrors: Map<number, string>
) => {
  if (err instanceof ScaleSdkError) {
    return err;
  }

  const translated = translateError(err as any, idlErrors);
  if (translated instanceof AnchorError) {
    return new ScaleSdkError(
      `${context}: ${translated.message}`,
      context,
      err,
      {
        logs: translated.logs,
        code: translated.error.errorCode.code,
        number: translated.error.errorCode.number,
      }
    );
  }

  if (translated instanceof Error) {
    return new ScaleSdkError(`${context}: ${translated.message}`, context, err);
  }

  return new ScaleSdkError(`${context}: Unknown error`, context, err);
};
