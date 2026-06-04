const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
      index: true,
    },
    invoiceNo: { type: String, trim: true, default: '' },
    billingStatus: {
      type: String,
      enum: [
        'Not Started',
        'LOI Received',
        'Advance Received',
        'Mobilisation Advance Received',
        '1st Running Bill Submitted',
        '50% Received',
        'Final Invoice Pending',
        'Retention Refund Pending',
        'Paid',
        'Overdue',
      ],
      default: 'Not Started',
      index: true,
    },
    amountTotal: { type: Number, default: 0 },
    amountReceived: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    dueDate: { type: Date },
    remarks: { type: String, trim: true, default: '' },
    paymentHistory: [
      {
        amount: Number,
        date: Date,
        note: String,
        recordedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true },
);

invoiceSchema.pre('save', function syncBalance() {
  this.balance = Number(this.amountTotal || 0) - Number(this.amountReceived || 0);
});

module.exports = mongoose.model('Invoice', invoiceSchema);
