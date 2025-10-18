import express from 'express';
import cors from 'cors';
import routes from './routes';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Vesting API server running on port ${PORT}`);
});

export default app;
