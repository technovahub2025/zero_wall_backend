const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');

const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/projects.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const actionsRoutes = require('./routes/actions.routes');
const teamRoutes = require('./routes/team.routes');
const stagesRoutes = require('./routes/stages.routes');
const reportsRoutes = require('./routes/reports.routes');
const uploadRoutes = require('./routes/upload.routes');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/stages', stagesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PG Infrastructure backend is running',
  });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
