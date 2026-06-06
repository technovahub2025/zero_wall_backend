const mongoose = require('mongoose');

const kanbanColumnSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    color: { type: String, default: '#3b82f6', trim: true },
    order: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { _id: false },
);

const kanbanBoardSchema = new mongoose.Schema(
  {
    boardType: {
      type: String,
      required: true,
      enum: ['task', 'overview'],
      unique: true,
      index: true,
    },
    columns: {
      type: [kanbanColumnSchema],
      default: [],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('KanbanBoard', kanbanBoardSchema);
