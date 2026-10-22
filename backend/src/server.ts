import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { db } from './db/database';
import authRoutes from './routes/auth.routes';
import financeRoutes from './routes/finance.routes';
import supportRoutes from './routes/support.routes';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// Necessário para proxies reversos em nuvem (Render, Railway, Fly.io, Cloudflare, Nginx)
app.set('trust proxy', 1);

// Inicializa o banco SQLite (modo WAL) na subida do servidor
db();

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: '512kb' }));
app.use(cookieParser());

// Healthcheck da API
app.get('/api/health', (_req, res) => {
  res.json({
    system: 'LK Finanças — Cofre Pessoal Zero-Knowledge',
    status: 'OK',
    database: 'SQLite (WAL Mode)',
    encryption: 'AES-256-GCM + scrypt Envelope Encryption',
    timestamp: new Date().toISOString(),
  });
});

// Rotas principais
app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/support', supportRoutes);

// Em produção ou túnel web, serve o build estático do Frontend PWA
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    next();
    return;
  }
  const indexHtml = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log('====================================================================');
  console.log('🛡️  LK FINANÇAS — SERVIDOR ZERO-KNOWLEDGE (SQLITE WAL) ATIVO');
  console.log(`🌐  Porta da API: http://localhost:${PORT}`);
  console.log('📄  Credenciais iniciais gravadas apenas em: backend/data/PRIMEIRO_ACESSO.txt');
  console.log('    (Anote-as em local seguro e apague o arquivo após o primeiro login)');
  console.log('====================================================================');
});
