// src/app.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db.js';
import contestsRouter from './routes/contests.js';
import attemptsRouter from './routes/attempts.js';
import adminContestsRouter from './routes/adminContests.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Simple health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error('Health check failed', err);
    res.status(500).json({ ok: false });
  }
});

// API routers
app.use('/api/contests', contestsRouter);
app.use('/api/attempts', attemptsRouter);
app.use('/api/admin', adminContestsRouter);

export default app;
