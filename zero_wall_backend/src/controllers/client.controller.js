const asyncHandler = require('../utils/asyncHandler');
const Client = require('../models/Client');
const { syncClientsFromProjects, findClientByName } = require('../utils/clientSync');
const { logActivity } = require('../utils/logActivity');
const { emitToAll } = require('../config/socket');

function toProjectIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeClientInput(body = {}, existing = null) {
  return {
    clientName: body.clientName ?? existing?.clientName ?? '',
    contactPerson: body.contactPerson ?? existing?.contactPerson ?? '',
    email: body.email ?? existing?.email ?? '',
    phone: body.phone ?? existing?.phone ?? '',
    companyName: body.companyName ?? existing?.companyName ?? '',
    segment: body.segment ?? existing?.segment ?? '',
    address: body.address ?? existing?.address ?? '',
    city: body.city ?? existing?.city ?? '',
    status: body.status ?? existing?.status ?? 'Active',
    notes: body.notes ?? existing?.notes ?? '',
    projectIds: toProjectIds(body.projectIds ?? existing?.projectIds ?? []),
    updatedBy: body.updatedBy ?? existing?.updatedBy ?? null,
  };
}

function serializeClient(client) {
  const item = client.toObject ? client.toObject({ virtuals: true }) : client;
  const projectIds = Array.isArray(item.projectIds) ? item.projectIds : [];
  return {
    id: item._id,
    clientName: item.clientName,
    contactPerson: item.contactPerson || '',
    email: item.email || '',
    phone: item.phone || '',
    companyName: item.companyName || '',
    segment: item.segment || '',
    address: item.address || '',
    city: item.city || '',
    status: item.status || 'Active',
    notes: item.notes || '',
    projectIds,
    projectCount: item.projectCount || projectIds.length,
    createdBy: item.createdBy,
    updatedBy: item.updatedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    projects: item.projects || [],
  };
}

async function populateClient(client) {
  return Client.findById(client._id).populate('projectIds', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment').populate('createdBy', 'name email role avatar').populate('updatedBy', 'name email role avatar');
}

const listClients = asyncHandler(async (req, res) => {
  await syncClientsFromProjects();
  const clients = await Client.find()
    .sort({ clientName: 1 })
    .populate('projectIds', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('createdBy', 'name email role avatar')
    .populate('updatedBy', 'name email role avatar');

  return res.json({
    success: true,
    data: clients.map(serializeClient),
  });
});

const getClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id)
    .populate('projectIds', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('createdBy', 'name email role avatar')
    .populate('updatedBy', 'name email role avatar');

  if (!client) {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }

  return res.json({ success: true, data: serializeClient(client) });
});

const createClient = asyncHandler(async (req, res) => {
  const clientName = String(req.body.clientName || '').trim();

  if (!clientName) {
    return res.status(400).json({ success: false, message: 'Client name is required' });
  }

  const existing = await findClientByName(clientName);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Client already exists' });
  }

  const client = await Client.create({
    ...normalizeClientInput({ ...req.body, clientName }),
    createdBy: req.user?.id || null,
  });

  const populated = await populateClient(client);
  await logActivity({
    actor: req.user?.id || null,
    action: 'client_created',
    entityType: 'client',
    entityId: populated._id,
    title: 'Client created',
    detail: `${populated.clientName} was added to client master data.`,
    tone: 'sky',
    link: '/clients',
    metadata: { clientName: populated.clientName },
  });

  emitToAll('client:created', serializeClient(populated));

  return res.status(201).json({ success: true, message: 'Client created', data: serializeClient(populated) });
});

const updateClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }

  const nextClientName = String(req.body.clientName || client.clientName || '').trim();
  if (nextClientName) {
    const existing = await findClientByName(nextClientName);
    if (existing && String(existing._id) !== String(client._id)) {
      return res.status(409).json({ success: false, message: 'Client already exists' });
    }
  }

  const previousName = client.clientName;
  Object.assign(client, normalizeClientInput({ ...req.body, clientName: nextClientName }, client));
  client.updatedBy = req.user?.id || client.updatedBy || null;
  await client.save();

  const populated = await populateClient(client);
  await logActivity({
    actor: req.user?.id || null,
    action: 'client_updated',
    entityType: 'client',
    entityId: populated._id,
    title: 'Client updated',
    detail: `${previousName} client record was updated.`,
    tone: 'blue',
    link: '/clients',
    metadata: { clientName: populated.clientName },
  });

  emitToAll('client:updated', serializeClient(populated));

  return res.json({ success: true, message: 'Client updated', data: serializeClient(populated) });
});

const deleteClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }

  await client.deleteOne();
  await logActivity({
    actor: req.user?.id || null,
    action: 'client_deleted',
    entityType: 'client',
    entityId: client._id,
    title: 'Client deleted',
    detail: `${client.clientName} was removed from client master data.`,
    tone: 'rose',
    link: '/clients',
    metadata: { clientName: client.clientName },
  });

  emitToAll('client:deleted', { id: String(client._id), clientName: client.clientName });

  return res.json({ success: true, message: 'Client deleted' });
});

module.exports = {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  serializeClient,
  normalizeClientInput,
};
