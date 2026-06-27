const asyncHandler = require('../utils/asyncHandler');
const Invoice = require('../models/Invoice');
const Project = require('../models/Project');
const { notifyAdmins, createNotification } = require('../utils/createNotification');
const { emitToAdmin } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');
const { logAuditEvent } = require('../middleware/auditLog');

function serializeInvoice(invoice) {
  const item = invoice.toObject ? invoice.toObject({ virtuals: true }) : invoice;
  return {
    id: item._id,
    project: item.project,
    invoiceNo: item.invoiceNo,
    billingStatus: item.billingStatus,
    amountTotal: item.amountTotal || 0,
    amountReceived: item.amountReceived || 0,
    balance: item.balance || 0,
    dueDate: item.dueDate || null,
    paidDate: item.paidDate || null,
    remarks: item.remarks || '',
    paymentHistory: item.paymentHistory || [],
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function syncProjectInvoice(invoice) {
  if (!invoice?.project) return;
  await Project.updateOne(
    { _id: invoice.project },
    {
      $set: {
        invoiceStatus: invoice.billingStatus,
        recv: invoice.amountReceived,
        balance: invoice.balance,
      },
    },
  );
}

async function populateInvoice(invoice) {
  return Invoice.findById(invoice._id).populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment').populate('createdBy', 'name avatar role employeeId');
}

const listInvoices = asyncHandler(async (req, res) => {
  const { project, status, search } = req.query;
  const filter = {};
  if (project) filter.project = project;
  if (status && status !== 'all') filter.billingStatus = status;

  let invoices = await Invoice.find(filter)
    .sort({ createdAt: -1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('createdBy', 'name avatar role employeeId');

  if (search) {
    const term = String(search).trim().toLowerCase();
    invoices = invoices.filter((invoice) =>
      invoice.project?.projectName?.toLowerCase().includes(term) ||
      invoice.project?.clientName?.toLowerCase().includes(term) ||
      invoice.invoiceNo?.toLowerCase().includes(term));
  }

  return res.json({ success: true, data: invoices.map(serializeInvoice) });
});

const getBillingSummary = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find().populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment');
  const totals = invoices.reduce(
    (acc, invoice) => {
      acc.total += Number(invoice.amountTotal || 0);
      acc.received += Number(invoice.amountReceived || 0);
      acc.balance += Number(invoice.balance || 0);
      return acc;
    },
    { total: 0, received: 0, balance: 0 },
  );

  const byStatus = invoices.reduce((acc, invoice) => {
    acc[invoice.billingStatus] = (acc[invoice.billingStatus] || 0) + 1;
    return acc;
  }, {});

  return res.json({
    success: true,
    data: {
      ...totals,
      byStatus,
      invoiceCount: invoices.length,
      overdue: invoices.filter((invoice) => invoice.billingStatus === 'Overdue').length,
    },
  });
});

const getInvoiceByProject = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({ project: req.params.projectId })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('createdBy', 'name avatar role employeeId');

  if (!invoice) {
    return res.json({ success: true, data: null });
  }

  return res.json({ success: true, data: serializeInvoice(invoice) });
});

const createInvoice = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.project);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const existing = await Invoice.findOne({ project: project._id });
  if (existing) {
    return res.status(409).json({ success: false, message: 'Invoice already exists for this project' });
  }

  const invoice = await Invoice.create({
    project: project._id,
    invoiceNo: req.body.invoiceNo || `ZW-INV-${String(project.sNo || Date.now()).padStart(3, '0')}`,
    billingStatus: req.body.billingStatus || 'Not Started',
    amountTotal: Number(req.body.amountTotal || 0),
    amountReceived: Number(req.body.amountReceived || 0),
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
    paidDate: req.body.paidDate ? new Date(req.body.paidDate) : undefined,
    remarks: req.body.remarks || '',
    createdBy: req.user?.id || null,
    updatedBy: req.user?.id || null,
    paymentHistory: Number(req.body.amountReceived || 0)
      ? [
          {
            amount: Number(req.body.amountReceived || 0),
            date: new Date(),
            note: 'Initial billing entry',
            recordedBy: req.user?.id || null,
          },
        ]
      : [],
  });

  await syncProjectInvoice(invoice);

  const populated = await populateInvoice(invoice);
  await notifyAdmins({
    sender: req.user?.id || null,
    type: 'billing_updated',
    title: 'Billing updated',
    message: `${project.projectName} billing record created`,
    link: '/billing',
    metadata: { projectId: project._id, projectName: project.projectName },
  });
  emitToAdmin('billing:updated', serializeInvoice(populated));
  await logActivity({
    actor: req.user?.id || null,
    action: 'invoice_created',
    entityType: 'invoice',
    entityId: populated._id,
    project: project._id,
    title: 'Invoice created',
    detail: `${populated.invoiceNo || 'Invoice'} was generated for billing review.`,
    tone: 'violet',
    link: '/billing',
    metadata: {
      projectName: project.projectName,
      invoiceNo: populated.invoiceNo || '',
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'invoice_created',
    resource: 'invoice',
    resourceId: String(populated._id),
  });

  return res.status(201).json({
    success: true,
    message: 'Invoice created',
    data: serializeInvoice(populated),
  });
});

const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Invoice not found' });
  }

  const previousReceived = Number(invoice.amountReceived || 0);
  if (req.body.invoiceNo !== undefined) invoice.invoiceNo = req.body.invoiceNo;
  if (req.body.billingStatus !== undefined) invoice.billingStatus = req.body.billingStatus;
  if (req.body.amountTotal !== undefined) invoice.amountTotal = Number(req.body.amountTotal || 0);
  if (req.body.amountReceived !== undefined) invoice.amountReceived = Number(req.body.amountReceived || 0);
  if (req.body.dueDate !== undefined) invoice.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : undefined;
  if (req.body.paidDate !== undefined) invoice.paidDate = req.body.paidDate ? new Date(req.body.paidDate) : undefined;
  if (req.body.remarks !== undefined) invoice.remarks = req.body.remarks;
  invoice.updatedBy = req.user?.id || invoice.updatedBy || null;
  if (invoice.billingStatus === 'Paid' && !invoice.paidDate) {
    invoice.paidDate = new Date();
  }

  const receivedDelta = Number(invoice.amountReceived || 0) - previousReceived;
  if (receivedDelta !== 0) {
    invoice.paymentHistory = invoice.paymentHistory || [];
    invoice.paymentHistory.push({
      amount: receivedDelta,
      date: new Date(),
      note: req.body.paymentNote || 'Invoice updated',
      recordedBy: req.user?.id || null,
    });
  }

  await invoice.save();
  await syncProjectInvoice(invoice);

  const populated = await populateInvoice(invoice);
  const project = populated.project;

  await notifyAdmins({
    sender: req.user?.id || null,
    type: 'billing_updated',
    title: 'Billing updated',
    message: `${project?.projectName || 'Project'} billing record updated`,
    link: '/billing',
    metadata: { projectId: project?._id, projectName: project?.projectName || '' },
  });
  emitToAdmin('billing:updated', serializeInvoice(populated));
  await logActivity({
    actor: req.user?.id || null,
    action: 'invoice_updated',
    entityType: 'invoice',
    entityId: populated._id,
    project: project?._id || invoice.project,
    title: 'Invoice updated',
    detail: `${populated.invoiceNo || 'Invoice'} billing status changed to ${populated.billingStatus}.`,
    tone: 'violet',
    link: '/billing',
    metadata: {
      projectName: project?.projectName || '',
      invoiceNo: populated.invoiceNo || '',
      billingStatus: populated.billingStatus,
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'invoice_updated',
    resource: 'invoice',
    resourceId: String(populated._id),
  });

  return res.json({
    success: true,
    message: 'Invoice updated',
    data: serializeInvoice(populated),
  });
});

const deleteInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('project', 'projectName');
  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Invoice not found' });
  }

  await Invoice.deleteOne({ _id: invoice._id });
  await Project.updateOne(
    { _id: invoice.project?._id || invoice.project },
    { $set: { invoiceStatus: '', recv: 0, balance: 0 } },
  );

  await createNotification({
    recipient: req.user?.id || invoice.createdBy || null,
    sender: req.user?.id || null,
    type: 'billing_updated',
    title: 'Invoice deleted',
    message: `${invoice.project?.projectName || 'Project'} invoice was deleted`,
    link: '/billing',
    metadata: { projectId: invoice.project?._id || invoice.project },
  });
  emitToAdmin('billing:updated', { id: req.params.id, deleted: true });
  await logActivity({
    actor: req.user?.id || null,
    action: 'invoice_deleted',
    entityType: 'invoice',
    entityId: invoice._id,
    project: invoice.project?._id || invoice.project,
    title: 'Invoice deleted',
    detail: `${invoice.project?.projectName || 'Project'} invoice was removed.`,
    tone: 'rose',
    link: '/billing',
    metadata: {
      projectName: invoice.project?.projectName || '',
      invoiceNo: invoice.invoiceNo || '',
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'invoice_deleted',
    resource: 'invoice',
    resourceId: String(invoice._id),
  });

  return res.json({ success: true, message: 'Invoice deleted' });
});

module.exports = {
  listInvoices,
  getBillingSummary,
  getInvoiceByProject,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  serializeInvoice,
};
