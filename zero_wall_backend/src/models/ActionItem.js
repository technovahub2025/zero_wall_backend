const mongoose = require('mongoose');

const actionItemSchema = new mongoose.Schema(
  {
    n: { type: Number, required: true },
    proj: { type: String, required: true, trim: true, index: true },
    client: { type: String, required: true, trim: true },
    status: { type: String, required: true, trim: true },
    pri: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    stage: { type: String, required: true },
    action: { type: String, required: true },
    resp: { type: String, required: true },
    target: { type: Date, required: true },
    decision: { type: String, required: true },
    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ActionItem', actionItemSchema);
