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
  console.error('❌ pg_infra: Missing required env vars:', missing.join(', '));
  console.error('Please check your .env file.');
  process.exit(1);
}

console.log('✅ Environment variables validated');

const app = require('./app');
const connectDB = require('./config/db');
const { createServer } = require('http');
const { initSocket } = require('./config/socket');
const { startCronJobs } = require('./utils/cronJobs');
const User = require('./models/User');

const PORT = process.env.PORT || 5000;

const DEFAULT_SUPERADMIN = {
  name: 'Super Admin',
  email: 'superadmin@gmail.com',
  password: 'Password@123',
  role: 'superadmin',
};

async function ensureDefaultSuperadmin() {
  const user = await User.findOne({ email: DEFAULT_SUPERADMIN.email });

  if (!user) {
    const superadmin = new User({
      name: DEFAULT_SUPERADMIN.name,
      email: DEFAULT_SUPERADMIN.email,
      role: DEFAULT_SUPERADMIN.role,
      isActive: true,
    });
    superadmin.password = DEFAULT_SUPERADMIN.password;
    await superadmin.save();
    console.log(`Default superadmin created: ${DEFAULT_SUPERADMIN.email}`);
    return;
  }

  let changed = false;

  if (user.role !== DEFAULT_SUPERADMIN.role) {
    user.role = DEFAULT_SUPERADMIN.role;
    changed = true;
  }

  if (!user.isActive) {
    user.isActive = true;
    changed = true;
  }

  if (changed) {
    await user.save();
    console.log(`Default superadmin updated: ${DEFAULT_SUPERADMIN.email}`);
  }
}

async function bootstrap() {
  await connectDB();
  await ensureDefaultSuperadmin();

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
