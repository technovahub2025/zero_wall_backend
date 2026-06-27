require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

function assertPasswordComplexity(password) {
  if (typeof password !== 'string' || password.length < 16) {
    throw new Error('SUPERADMIN_PASSWORD must be at least 16 characters long');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(password)) {
    throw new Error('SUPERADMIN_PASSWORD must include upper, lower, digit, and special character');
  }
}

async function main() {
  const email = String(process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SUPERADMIN_PASSWORD || '');

  if (!email || !password) {
    throw new Error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required');
  }

  assertPasswordComplexity(password);

  if (process.env.NODE_ENV === 'production') {
    console.warn('Warning: running the superadmin seed script in production.');
  }

  await connectDB();

  const existing = await User.findOne({ email });
  if (existing) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to seed: user already exists in production');
    }

    existing.role = 'superadmin';
    existing.isActive = true;
    existing.password = password;
    await existing.save();
    console.log(`Superadmin updated: ${email}`);
    await mongoose.disconnect();
    return;
  }

  const user = new User({
    name: 'Super Admin',
    email,
    role: 'superadmin',
    isActive: true,
  });
  user.password = password;
  await user.save();
  console.log(`Superadmin created: ${email}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
