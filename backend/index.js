import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Routes
// import authRoutes from './routes/auth.js';
// app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Lavanderia El Sol API running' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
