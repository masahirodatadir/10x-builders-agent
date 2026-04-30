import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://5421adcd511393fb1461ba8813e9e09f@o4511311274704896.ingest.us.sentry.io/4511311280406528",

  integrations: [Sentry.replayIntegration()],

  tracesSampleRate: 1,
  enableLogs: true,

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
