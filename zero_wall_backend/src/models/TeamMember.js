const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema(
  {
    initials: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, index: true },
    role: { type: String, required: true, trim: true },
    projects: { type: Number, default: 0 },
    color: { type: String, default: '#3b82f6' },
    online: { type: Boolean, default: false },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('TeamMember', teamMemberSchema);
