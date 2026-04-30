import * as Sentry from "@sentry/nextjs";

class SentryExampleAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentryExampleAPIError";
  }
}

export function GET() {
  Sentry.logger.info("Sentry example API called");

  throw new SentryExampleAPIError(
    "This error is raised on the backend called by the example page.",
  );
}
