const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
const taskRoutes = require('./routes/task.routes');
const reportsRoutes = require('./routes/reports.routes');
const billingRoutes = require('./routes/billing.routes');
const notificationRoutes = require('./routes/notification.routes');
const activityRoutes = require('./routes/activity.routes');
const settingsRoutes = require('./routes/settings.routes');
const uploadRoutes = require('./routes/upload.routes');
const employeeRoutes = require('./routes/employee.routes');
const timerRoutes = require('./routes/timer.routes');
const { notFound, errorHandler } = require('./middleware/error.middleware');
const {
  securityHeaders,
  sanitizeMongo,
  sanitizeXSS,
  authRateLimit,
  uploadRateLimit,
  apiRateLimit,
} = require('./middleware/securityMiddleware');
const {
  requestTimer,
  jsonSizeLimit,
  cacheControl,
} = require('./middleware/performanceMiddleware');
const { getClientUrl } = require('./utils/env');

const app = express();
app.disable('x-powered-by');

app.use(
  cors({
    origin: getClientUrl(),
    credentials: true,
  }),
);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(securityHeaders);
app.use(sanitizeMongo);
app.use(sanitizeXSS);
app.use(requestTimer);
app.use(jsonSizeLimit);
app.use(cacheControl());

app.use('/api', apiRateLimit);
app.use('/api/auth', authRateLimit);
app.use('/api/upload', uploadRateLimit);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects/:projectId/stages', stagesRoutes);
app.use('/api/actions', actionsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/stages', stagesRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/activity-logs', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/timer', timerRoutes);
app.use('/api/employees', employeeRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'backend is running',
  });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
