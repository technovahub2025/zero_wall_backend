const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getTokenExpiryMs } = require('../utils/tokenExpiry');

const inviteHistorySchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
    },
    expiry: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email'],
    },
    passwordHash: {
      type: String,
      select: false,
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin', 'project_manager', 'employee'],
      default: 'employee',
    },
    refreshTokenVersion: {
      type: Number,
      default: 0,
    },
    avatar: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    avatarPublicId: {
      type: String,
      default: '',
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    emergencyPhone: {
      type: String,
      trim: true,
      default: '',
    },
    designation: {
      type: String,
      default: '',
    },
    department: {
      type: String,
      enum: ['Structural', 'Architectural', 'Electrical', 'PEB', 'Management', ''],
      default: '',
    },
    employeeId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    joiningDate: {
      type: Date,
    },
    documents: [
      {
        name: String,
        url: String,
        publicId: String,
        type: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    inviteToken: {
      type: String,
      select: false,
    },
    inviteExpiry: {
      type: Date,
      select: false,
    },
    inviteTokenPrevious: {
      type: String,
      select: false,
    },
    inviteExpiryPrevious: {
      type: Date,
      select: false,
    },
    inviteTokenHistory: {
      type: [inviteHistorySchema],
      default: [],
      select: false,
    },
    resetToken: {
      type: String,
      select: false,
    },
    resetExpiry: {
      type: Date,
      select: false,
    },
    lastLogin: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

userSchema.virtual('password').set(function setPassword(value) {
  this._plainPassword = value;
});

userSchema.pre('save', async function hashPasswordAndAllocateEmployeeId() {
  if (this._plainPassword) {
    this.passwordHash = await bcrypt.hash(this._plainPassword, 12);
    this._plainPassword = undefined;
  }

  if (this.isNew && !this.employeeId) {
    const count = await this.constructor.countDocuments({});
    this.employeeId = `ZW-${String(count + 1).padStart(3, '0')}`;
  }
});

userSchema.methods.matchPassword = function matchPassword(enteredPassword) {
  if (!this.passwordHash) {
    return false;
  }

  return bcrypt.compare(enteredPassword, this.passwordHash);
};

userSchema.methods.generateInviteToken = function generateInviteToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const history = Array.isArray(this.inviteTokenHistory) ? this.inviteTokenHistory : [];
  const nextHistory = [];

  if (this.inviteToken && this.inviteExpiry) {
    nextHistory.push({ token: this.inviteToken, expiry: this.inviteExpiry });
  }

  if (this.inviteTokenPrevious && this.inviteExpiryPrevious) {
    nextHistory.push({ token: this.inviteTokenPrevious, expiry: this.inviteExpiryPrevious });
  }

  nextHistory.push(
    ...history.filter((entry) => entry?.token && entry?.expiry),
  );

  this.inviteTokenHistory = nextHistory.slice(0, 5);
  this.inviteTokenPrevious = this.inviteToken || undefined;
  this.inviteExpiryPrevious = this.inviteExpiry || undefined;
  this.inviteToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.inviteExpiry = new Date(Date.now() + getTokenExpiryMs('INVITE_TOKEN_EXPIRES_IN_HOURS', 48));
  return rawToken;
};

userSchema.methods.generateResetToken = function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.resetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.resetExpiry = new Date(Date.now() + getTokenExpiryMs('RESET_TOKEN_EXPIRES_IN_HOURS', 24));
  return rawToken;
};

module.exports = mongoose.model('User', userSchema);
