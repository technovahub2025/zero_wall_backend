const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Team = require('../models/Team');
const TimerLog = require('../models/TimerLog');
const { sendEmail, inviteEmailTemplate } = require('../utils/sendEmail');
const { createNotification } = require('../utils/createNotification');
const { emitToUser } = require('../config/socket');
const { getClientUrl } = require('../utils/env');

function serializeEmployee(user) {
  const item = user.toObject ? user.toObject({ virtuals: true }) : user;
  return {
    id: item._id,
    name: item.name,
    email: item.email,
    role: item.role,
    avatar: item.avatar,
    avatarPublicId: item.avatarPublicId,
    isActive: item.isActive,
    phone: item.phone || '',
    designation: item.designation || '',
    department: item.department || '',
    employeeId: item.employeeId,
    joiningDate: item.joiningDate || null,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastLogin: item.lastLogin || null,
  };
}

function normalizeRole(role) {
  const allowed = ['admin', 'project_manager', 'employee'];
  if (!role) return 'employee';
  return allowed.includes(role) ? role : 'employee';
}

async function sendInviteIfRequested(user, req) {
  const inviteToken = crypto.randomBytes(32).toString('hex');
  user.inviteToken = crypto.createHash('sha256').update(inviteToken).digest('hex');
  user.inviteExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await user.save();

  const inviteUrl = `${getClientUrl()}/invite/${inviteToken}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'ZEROWALL'} invitation`,
    html: inviteEmailTemplate({
      inviteeName: user.name,
      inviterName: req.user?.name || 'A teammate',
      role: user.role,
      inviteUrl,
    }),
  });

  return inviteUrl;
}

async function getTeamIdsForMember(userId) {
  if (!userId) return [];
  const teams = await Team.find({ members: userId }).select('_id');
  return teams.map((team) => team._id);
}

const listEmployees = asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const department = String(req.query.department || '').trim();
  const role = String(req.query.role || '').trim();

  const filter = { role: { $ne: 'superadmin' } };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { designation: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
    ];
  }
  if (department && department !== 'all') {
    filter.department = department;
  }
  if (role && role !== 'all') {
    filter.role = role;
  }

  const employees = await User.find(filter).sort({ createdAt: -1 });
  return res.json({
    success: true,
    data: employees.map(serializeEmployee),
  });
});

const getEmployee = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee || employee.role === 'superadmin' && req.user.role !== 'superadmin') {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const teamIds = await getTeamIdsForMember(employee._id);
  const tasks = await Task.find({
    $or: [
      { assignee: employee._id },
      { reporter: employee._id },
      { assignedTeam: employee._id },
      ...(teamIds.length ? [{ team: { $in: teamIds } }] : []),
    ],
  })
    .sort({ dueDate: 1, order: 1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('assignedTeam', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar')
    .populate('reporter', 'name email role avatar employeeId designation department')
    .populate({
      path: 'team',
      select: 'name description color members isActive',
      populate: {
        path: 'members',
        select: 'name email role avatar employeeId designation department',
      },
    });

  const projects = await Project.find({
    $or: [{ responsibleEngineer: employee._id }, { assignedTeam: employee._id }],
  }).sort({ createdAt: -1 });

  const logs = await TimerLog.find({ user: employee._id }).sort({ date: -1, startTime: -1 });

  return res.json({
    success: true,
    data: {
      ...serializeEmployee(employee),
      tasks: tasks.map((task) => task.toObject({ virtuals: true })),
      projects: projects.map((project) => project.toObject({ virtuals: true })),
      totalLoggedSeconds: logs.reduce((sum, log) => sum + Number(log.duration || 0), 0),
    },
  });
});

const createEmployee = asyncHandler(async (req, res) => {
  const { name, email, role, phone, designation, department, password, confirmPassword, sendInvite = false, joiningDate, avatar, isActive } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing && existing.isActive && !sendInvite) {
    return res.status(409).json({ success: false, message: 'Employee already exists' });
  }

  const employee = existing || new User({ email });
  employee.name = name || employee.name || email.split('@')[0];
  employee.role = normalizeRole(role);
  employee.phone = phone || employee.phone || '';
  employee.designation = designation || employee.designation || '';
  employee.department = department || employee.department || '';
  employee.joiningDate = joiningDate ? new Date(joiningDate) : employee.joiningDate || new Date();
  employee.avatar = avatar ?? employee.avatar ?? '';
  employee.isActive = typeof isActive === 'boolean' ? isActive : !sendInvite;
  employee.createdBy = req.user?.id || employee.createdBy || null;
  if (password) {
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }
    employee.password = password;
  }

  await employee.save();

  if (sendInvite) {
    await sendInviteIfRequested(employee, req);
  }

  return res.status(201).json({
    success: true,
    message: sendInvite ? 'Invite sent' : 'Employee created',
    data: serializeEmployee(employee),
  });
});

const updateEmployee = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const fields = ['name', 'email', 'phone', 'designation', 'department', 'joiningDate', 'avatar', 'isActive'];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      employee[field] = field === 'joiningDate' && req.body[field] ? new Date(req.body[field]) : req.body[field];
    }
  });

  await employee.save();

  return res.json({
    success: true,
    message: 'Employee updated',
    data: serializeEmployee(employee),
  });
});

const updateEmployeeRole = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const role = normalizeRole(req.body.role);
  employee.role = role;
  await employee.save();

  emitToUser(String(employee._id), 'role:changed', {
    role,
    userId: employee._id,
  });

  await createNotification({
    recipient: employee._id,
    sender: req.user?.id || null,
    type: 'role_changed',
    title: 'Role changed',
    message: `Your role has been updated to ${role}`,
    link: '/profile',
    metadata: { projectName: '' },
  });

  return res.json({
    success: true,
    message: 'Role updated',
    data: serializeEmployee(employee),
  });
});

const deactivateEmployee = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  employee.isActive = false;
  await employee.save();

  return res.json({
    success: true,
    message: 'Employee deactivated',
    data: serializeEmployee(employee),
  });
});

const getEmployeeTasks = asyncHandler(async (req, res) => {
  const teamIds = await getTeamIdsForMember(req.params.id);
  const tasks = await Task.find({
    $or: [
      { assignee: req.params.id },
      { reporter: req.params.id },
      { assignedTeam: req.params.id },
      ...(teamIds.length ? [{ team: { $in: teamIds } }] : []),
    ],
  })
    .sort({ dueDate: 1, order: 1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('assignedTeam', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar')
    .populate('reporter', 'name email role avatar employeeId designation department')
    .populate({
      path: 'team',
      select: 'name description color members isActive',
      populate: {
        path: 'members',
        select: 'name email role avatar employeeId designation department',
      },
    });

  const grouped = tasks.reduce(
    (acc, task) => {
      const item = task.toObject({ virtuals: true });
      acc[item.status] = acc[item.status] || [];
      acc[item.status].push(item);
      return acc;
    },
    { todo: [], 'in-progress': [], review: [], done: [] },
  );

  return res.json({
    success: true,
    data: {
      tasks: tasks.map((task) => task.toObject({ virtuals: true })),
      grouped,
      counts: {
        todo: grouped.todo.length,
        'in-progress': grouped['in-progress'].length,
        review: grouped.review.length,
        done: grouped.done.length,
      },
    },
  });
});

const getEmployeeWorkload = asyncHandler(async (req, res) => {
  const teamIds = await getTeamIdsForMember(req.params.id);
  const tasks = await Task.find({
    $or: [
      { assignee: req.params.id },
      { reporter: req.params.id },
      { assignedTeam: req.params.id },
      ...(teamIds.length ? [{ team: { $in: teamIds } }] : []),
    ],
  })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate({
      path: 'team',
      select: 'name description color members isActive',
      populate: {
        path: 'members',
        select: 'name email role avatar employeeId designation department',
      },
    });
  const projects = await Project.find({
    $or: [{ responsibleEngineer: req.params.id }, { assignedTeam: req.params.id }],
  }).sort({ createdAt: -1 });
  const logs = await TimerLog.find({ user: req.params.id }).populate('project', 'projectName clientName');

  const projectMap = new Map();
  projects.forEach((project) => {
    const item = project.toObject({ virtuals: true });
    projectMap.set(String(item._id), {
      id: item._id,
      projectName: item.projectName,
      clientName: item.clientName,
      hours: 0,
      taskCount: 0,
    });
  });

  tasks.forEach((task) => {
    const key = String(task.project?._id || task.project);
    if (!projectMap.has(key)) {
      projectMap.set(key, {
        id: key,
        projectName: task.project?.projectName || 'Project',
        clientName: task.project?.clientName || '',
        hours: 0,
        taskCount: 0,
      });
    }
    const entry = projectMap.get(key);
    entry.taskCount += 1;
  });

  logs.forEach((log) => {
    const key = String(log.project?._id || log.project);
    if (!projectMap.has(key)) {
      projectMap.set(key, {
        id: key,
        projectName: log.project?.projectName || 'Project',
        clientName: log.project?.clientName || '',
        hours: 0,
        taskCount: 0,
      });
    }
    const entry = projectMap.get(key);
    entry.hours += Number(log.duration || 0) / 3600;
  });

  return res.json({
    success: true,
    data: {
      projects: [...projectMap.values()],
      totalHours: logs.reduce((sum, log) => sum + Number(log.duration || 0), 0) / 3600,
      tasks: tasks.length,
    },
  });
});

const getEmployeeTimesheets = asyncHandler(async (req, res) => {
  const logs = await TimerLog.find({ user: req.params.id })
    .sort({ date: -1, startTime: -1 })
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  return res.json({
    success: true,
    data: logs.map((log) => log.toObject({ virtuals: true })),
  });
});

module.exports = {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  updateEmployeeRole,
  deactivateEmployee,
  getEmployeeTasks,
  getEmployeeWorkload,
  getEmployeeTimesheets,
  serializeEmployee,
};
