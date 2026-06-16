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
const { serializeTasksWithRequests } = require('./task.controller');
const { getTokenExpiryMs } = require('../utils/tokenExpiry');

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
    emergencyPhone: item.emergencyPhone || '',
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

function normalizePhone(value) {
  return String(value || '').replace(/[\s-]/g, '').trim();
}

function validateTenDigitPhone(value, label) {
  const normalized = normalizePhone(value);
  if (!/^\d{10}$/.test(normalized)) {
    return `${label} must be exactly 10 digits`;
  }
  return '';
}

function validateRequiredEmployeeFields(body) {
  const requiredFields = [
    ['employeeId', 'Employee ID'],
    ['name', 'Name'],
    ['email', 'Email'],
    ['phone', 'Mobile number'],
    ['emergencyPhone', 'Emergency number'],
    ['joiningDate', 'Joining date'],
  ];

  for (const [field, label] of requiredFields) {
    if (!String(body[field] || '').trim()) {
      return `${label} is required`;
    }
  }

  const mobileError = validateTenDigitPhone(body.phone, 'Mobile number');
  if (mobileError) return mobileError;

  const emergencyError = validateTenDigitPhone(body.emergencyPhone, 'Emergency number');
  if (emergencyError) return emergencyError;

  const joiningDate = new Date(body.joiningDate);
  if (Number.isNaN(joiningDate.getTime())) {
    return 'Joining date is invalid';
  }

  return '';
}

async function findEmployeeIdConflict(employeeId, currentId = null) {
  const normalizedEmployeeId = String(employeeId || '').trim();
  if (!normalizedEmployeeId) return null;

  const filter = { employeeId: normalizedEmployeeId };
  if (currentId) {
    filter._id = { $ne: currentId };
  }
  return User.findOne(filter).select('_id employeeId');
}

async function findEmailConflict(email, currentId = null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const filter = { email: normalizedEmail };
  if (currentId) {
    filter._id = { $ne: currentId };
  }
  return User.findOne(filter).select('_id email');
}

async function sendInviteIfRequested(user, req) {
  const inviteToken = user.generateInviteToken();
  await user.save();

  const inviteUrl = `${getClientUrl()}/invite/${inviteToken}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'PG Infrastructure'} invitation for ${user.name}`,
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
      { emergencyPhone: { $regex: search, $options: 'i' } },
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

  const serializedTasks = await serializeTasksWithRequests(tasks);

  return res.json({
    success: true,
    data: {
      ...serializeEmployee(employee),
      tasks: serializedTasks,
      projects: projects.map((project) => project.toObject({ virtuals: true })),
      totalLoggedSeconds: logs.reduce((sum, log) => sum + Number(log.duration || 0), 0),
    },
  });
});

const createEmployee = asyncHandler(async (req, res) => {
  const { employeeId, name, email, role, phone, emergencyPhone, designation, department, password, confirmPassword, sendInvite = false, joiningDate, avatar, isActive } = req.body;
  const validationError = validateRequiredEmployeeFields(req.body);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() })
    .select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
  if (existing && existing.isActive && !sendInvite) {
    return res.status(409).json({ success: false, message: 'Email already exists' });
  }

  const employeeIdConflict = await findEmployeeIdConflict(employeeId, existing?._id);
  if (employeeIdConflict) {
    return res.status(409).json({ success: false, message: 'Employee ID already exists' });
  }

  const employee = existing || new User({ email });
  employee.employeeId = String(employeeId).trim();
  employee.name = String(name).trim();
  employee.role = normalizeRole(role);
  employee.phone = normalizePhone(phone);
  employee.emergencyPhone = normalizePhone(emergencyPhone);
  employee.designation = designation || employee.designation || '';
  employee.department = department || employee.department || '';
  employee.joiningDate = new Date(joiningDate);
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
  const employee = await User.findById(req.params.id).select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const strictFields = ['employeeId', 'name', 'email', 'phone', 'emergencyPhone', 'designation', 'department', 'joiningDate'];
  const requiresStrictValidation = strictFields.some((field) => req.body[field] !== undefined);
  if (requiresStrictValidation) {
    const validationError = validateRequiredEmployeeFields({ ...employee.toObject(), ...req.body });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
  }

  if (req.body.employeeId !== undefined) {
    const employeeIdConflict = await findEmployeeIdConflict(req.body.employeeId, employee._id);
    if (employeeIdConflict) {
      return res.status(409).json({ success: false, message: 'Employee ID already exists' });
    }
  }

  if (req.body.email !== undefined) {
    const emailConflict = await findEmailConflict(req.body.email, employee._id);
    if (emailConflict) {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }
  }

  const sendInvite = Boolean(req.body.sendInvite);
  const nextPassword = String(req.body.password || '').trim();
  const nextConfirmPassword = String(req.body.confirmPassword || '').trim();
  if (nextPassword) {
    if (!nextConfirmPassword) {
      return res.status(400).json({ success: false, message: 'Confirm password is required' });
    }
    if (nextPassword !== nextConfirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }
    employee.password = nextPassword;
  }

  const fields = ['employeeId', 'name', 'email', 'phone', 'emergencyPhone', 'designation', 'department', 'joiningDate', 'avatar', 'isActive'];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      if (field === 'joiningDate') {
        employee[field] = new Date(req.body[field]);
      } else if (field === 'phone' || field === 'emergencyPhone') {
        employee[field] = normalizePhone(req.body[field]);
      } else if (typeof req.body[field] === 'string') {
        employee[field] = req.body[field].trim();
      } else {
        employee[field] = req.body[field];
      }
    }
  });

  await employee.save();

  if (sendInvite) {
    await sendInviteIfRequested(employee, req);
  }

  return res.json({
    success: true,
    message: sendInvite ? 'Invite sent' : 'Employee updated',
    data: serializeEmployee(employee),
  });
});

const updateEmployeeRole = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id).select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
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

const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }

  const data = serializeEmployee(employee);
  await employee.deleteOne();

  return res.json({
    success: true,
    message: 'Employee deleted',
    data,
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

  const serializedTasks = await serializeTasksWithRequests(tasks);
  const grouped = serializedTasks.reduce(
    (acc, task) => {
      acc[task.status] = acc[task.status] || [];
      acc[task.status].push(task);
      return acc;
    },
    { todo: [], 'in-progress': [], review: [], done: [] },
  );

  return res.json({
    success: true,
    data: {
      tasks: serializedTasks,
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
  deleteEmployee,
  getEmployeeTasks,
  getEmployeeWorkload,
  getEmployeeTimesheets,
  serializeEmployee,
};
