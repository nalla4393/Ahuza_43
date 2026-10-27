import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import createFileStore from 'session-file-store';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { uploadRoot } from './server/services/images.js';
import { api, expireReservationsOnStartup } from './server/routes.js';
import { expirePendingOrders, startFollowUpScheduler } from './server/services/integrations.js';
import { startSocialScheduler } from './server/services/social.js';
import { sendRestockAlerts } from './server/services/stock-alerts.js';

const app = express();
const FileStore = createFileStore(session);
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3001);
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? '' : 'local-development-only-change-me');

if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters, including in production.');
if (isProduction && !process.env.OWNER_API_KEY) throw new Error('OWNER_API_KEY must be configured in production.');
if (isProduction) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
      frameSrc: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use((request, response, next) => {
  if (request.hostname === 'ahuzawear.com') {
    response.redirect(308, `https://www.ahuzawear.com${request.originalUrl}`);
    return;
  }
  next();
});
if (process.env.FRONTEND_ORIGIN || !isProduction) app.use(cors({
  origin(origin, callback) {
    const allowed = process.env.FRONTEND_ORIGIN;
    if (!origin || origin === allowed || (!isProduction && /^http:\/\/localhost:\d+$/.test(origin))) { callback(null, true); return; }
    callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Owner-Key', 'X-File-Name', 'Idempotency-Key', 'X-Ahuza-Signature'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({
  limit: '32kb',
  verify: (request, _response, body) => {
    (request as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
  },
}));
app.use(session({
  name: 'ahuza.sid',
  secret: sessionSecret,
  store: new FileStore({
    path: path.resolve(process.env.SESSION_FILE_PATH || '.data/sessions'),
    ttl: 7 * 24 * 60 * 60,
    reapInterval: 60 * 60,
    retries: 0,
    secret: sessionSecret,
  }),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use('/uploads', express.static(uploadRoot, { index: false, dotfiles: 'deny', immutable: true, maxAge: '365d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/api', api);
const frontendPath = path.resolve('dist');
if (existsSync(frontendPath)) {
  app.use(express.static(frontendPath, { index: false, maxAge: isProduction ? '1h' : 0 }));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(frontendPath, 'index.html')));
} else {
  app.use((_request, response) => response.status(404).json({ error: 'Not found.' }));
}

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) { next(error); return; }
  const status = error && typeof error === 'object' && 'status' in error
    && typeof error.status === 'number' && error.status >= 400 && error.status < 500
    ? error.status
    : error instanceof Error && error.message === 'Origin is not allowed by CORS.' ? 403 : 500;
  if (status >= 500) console.error(error);
  const message = status === 413 ? 'Request body is too large.' : status < 500 ? 'Invalid request.' : 'An unexpected server error occurred.';
  response.status(status).json({ error: message });
});

void expireReservationsOnStartup().catch((error) => console.error('Reservation cleanup failed:', error));
const reservationTimer = setInterval(() => void expirePendingOrders().catch((error) => console.error('Reservation cleanup failed:', error)), 60 * 1000);
reservationTimer.unref();
startFollowUpScheduler();
startSocialScheduler();
const stockAlertTimer = setInterval(() => void sendRestockAlerts().catch((error) => console.error('Restock alert scan failed:', error)), 15 * 60 * 1000);
stockAlertTimer.unref();

app.listen(port, '0.0.0.0', () => console.info(`Ahuza API listening on port ${port}`));