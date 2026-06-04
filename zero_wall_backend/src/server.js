require('dotenv').config();

const REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'CLIENT_URL',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ ZEROWALL: Missing required env vars:', missing.join(', '));
  console.error('Please check your .env file.');
  process.exit(1);
}

console.log('✅ Environment variables validated');

const app = require('./app');
const connectDB = require('./config/db');
const { createServer } = require('http');
const { initSocket } = require('./config/socket');
const { startCronJobs } = require('./utils/cronJobs');

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();

  const server = createServer(app);
  const io = initSocket(server);
  app.set('io', io);
  startCronJobs();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
