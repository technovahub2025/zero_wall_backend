require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const RefreshToken = require('./src/models/RefreshToken');
const Project = require('./src/models/Project');
const Stage = require('./src/models/Stage');
const Task = require('./src/models/Task');
const Invoice = require('./src/models/Invoice');
const Notification = require('./src/models/Notification');
const ActionItem = require('./src/models/ActionItem');
const TeamMember = require('./src/models/TeamMember');
const TimerLog = require('./src/models/TimerLog');
const ActivityLog = require('./src/models/ActivityLog');

const seedUsers = [
  {
    name: 'Aarav Mehta',
    email: 'superadmin@zerowall.app',
    password: 'Password@123',
    role: 'superadmin',
    designation: 'Managing Director',
    department: 'Management',
    phone: '+91-9000000001',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@zerowall.app',
    password: 'Password@123',
    role: 'admin',
    designation: 'Operations Lead',
    department: 'Management',
    phone: '+91-9000000002',
  },
  {
    name: 'Arjun Mehta',
    email: 'arjun@zerowall.app',
    password: 'Password@123',
    role: 'admin',
    designation: 'Project Lead',
    department: 'Structural',
    phone: '+91-9000000003',
  },
  {
    name: 'Karthik Rao',
    email: 'karthik@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Engineer',
    department: 'Architectural',
    phone: '+91-9000000004',
  },
  {
    name: 'Dinesh Kumar',
    email: 'dinesh@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Engineer',
    department: 'Electrical',
    phone: '+91-9000000005',
  },
  {
    name: 'Rohan Gupta',
    email: 'admin2@zerowall.app',
    password: 'Password@123',
    role: 'admin',
    designation: 'Project Manager',
    department: 'Structural',
    phone: '+91-9000000006',
  },
  {
    name: 'Neha Iyer',
    email: 'employee1@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Structural Engineer',
    department: 'Structural',
    phone: '+91-9000000007',
  },
  {
    name: 'Kabir Singh',
    email: 'employee2@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Site Engineer',
    department: 'Architectural',
    phone: '+91-9000000008',
  },
  {
    name: 'Ananya Rao',
    email: 'employee3@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Design Engineer',
    department: 'Electrical',
    phone: '+91-9000000009',
  },
  {
    name: 'Vikram Das',
    email: 'employee4@zerowall.app',
    password: 'Password@123',
    role: 'employee',
    designation: 'Estimator',
    department: 'PEB',
    phone: '+91-9000000010',
  },
];

const projectSeeds = [
  {
    sNo: 1,
    projectName: 'Ravi Residency Complex',
    clientName: 'Mr. Ravi Kumar',
    companySegment: 'Residential',
    projectType: ['Structural + Architectural'],
    location: 'Puducherry',
    startDate: new Date('2025-06-01'),
    targetDate: new Date('2025-06-30'),
    projectValue: 42.5,
    overallStatus: 'In Progress',
    currentStage: 'Working Drawings',
    stageCompletion: 65,
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-03-15'),
    nextActionRequired: 'Submit GFC Drawings',
    ceoMdReview: 'Reviewed',
    priority: 'High',
    invoiceStatus: '50% Received',
    estimatedCompletion: 65,
    recv: 21.25,
    balance: 21.25,
    engineerEmail: 'arjun@zerowall.app',
  },
  {
    sNo: 2,
    projectName: 'Sri Sai Commercial Plaza',
    clientName: 'M/s Sri Sai Builders',
    companySegment: 'Commercial',
    projectType: ['Architectural + Electrical'],
    location: 'Chennai',
    startDate: new Date('2025-02-15'),
    targetDate: new Date('2025-09-15'),
    projectValue: 87,
    overallStatus: 'In Progress',
    currentStage: 'Structural Design',
    stageCompletion: 40,
    clientApprovalStatus: 'Pending',
    nextActionRequired: 'Obtain soil report from client',
    ceoMdReview: 'Pending',
    priority: 'High',
    invoiceStatus: 'Advance Received',
    estimatedCompletion: 40,
    recv: 10,
    balance: 77,
    engineerEmail: 'priya@zerowall.app',
  },
  {
    sNo: 3,
    projectName: 'Coromandel Warehouse',
    clientName: 'M/s PQR Logistics',
    companySegment: 'Industrial',
    projectType: ['PEB Structure'],
    location: 'Cuddalore',
    startDate: new Date('2024-11-01'),
    targetDate: new Date('2025-03-31'),
    projectValue: 120,
    overallStatus: 'Completed',
    currentStage: 'As-Built Drawings',
    stageCompletion: 100,
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-02-28'),
    nextActionRequired: 'Final Invoice Submission',
    ceoMdReview: 'Reviewed',
    priority: 'Medium',
    invoiceStatus: 'Final Invoice Pending',
    estimatedCompletion: 100,
    recv: 120,
    balance: 0,
    engineerEmail: 'karthik@zerowall.app',
  },
  {
    sNo: 4,
    projectName: 'Green Valley Villas Ph.2',
    clientName: 'Mr. Suresh Nair',
    companySegment: 'Residential',
    projectType: ['Structural Engineering'],
    location: 'Villupuram',
    startDate: new Date('2025-03-10'),
    targetDate: new Date('2025-10-10'),
    projectValue: 33.75,
    overallStatus: 'On Hold',
    currentStage: 'Concept Design',
    stageCompletion: 20,
    clientApprovalStatus: 'Not Submitted',
    nextActionRequired: 'Client to confirm revised layout',
    ceoMdReview: 'Escalate',
    priority: 'Medium',
    invoiceStatus: 'Not Started',
    estimatedCompletion: 20,
    recv: 0,
    balance: 33.75,
    engineerEmail: 'arjun@zerowall.app',
  },
  {
    sNo: 5,
    projectName: 'Apex Auto Factory',
    clientName: 'Apex Auto Parts Ltd.',
    companySegment: 'Manufacturing',
    projectType: ['Structural + PEB + Electrical'],
    location: 'Hosur',
    startDate: new Date('2025-04-01'),
    targetDate: new Date('2025-12-31'),
    projectValue: 345,
    overallStatus: 'In Progress',
    currentStage: 'Detailed Engineering',
    stageCompletion: 30,
    clientApprovalStatus: 'In Review',
    clientApprovalDate: new Date('2025-05-05'),
    nextActionRequired: 'Finalise column layout with client',
    ceoMdReview: 'Scheduled',
    priority: 'Critical',
    invoiceStatus: 'Mobilisation Advance Received',
    estimatedCompletion: 30,
    recv: 21.25,
    balance: 323.75,
    engineerEmail: 'priya@zerowall.app',
  },
  {
    sNo: 6,
    projectName: 'Surya Pharma Plant',
    clientName: 'Surya Life Sciences',
    companySegment: 'Industrial',
    projectType: ['Electrical Consulting'],
    location: 'Ranipet',
    startDate: new Date('2025-06-20'),
    targetDate: new Date('2025-07-20'),
    projectValue: 58,
    overallStatus: 'In Progress',
    currentStage: 'Load Schedule & SLD',
    stageCompletion: 55,
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-04-10'),
    nextActionRequired: 'Prepare panel schedule',
    ceoMdReview: 'Reviewed',
    priority: 'High',
    invoiceStatus: '1st Running Bill Submitted',
    estimatedCompletion: 55,
    recv: 10,
    balance: 48,
    engineerEmail: 'dinesh@zerowall.app',
  },
  {
    sNo: 7,
    projectName: 'Lotus IT Park',
    clientName: 'Lotus Developers',
    companySegment: 'Commercial',
    projectType: ['Architectural + Electrical'],
    location: 'Chennai',
    startDate: new Date('2024-06-15'),
    targetDate: new Date('2024-12-15'),
    projectValue: 280,
    overallStatus: 'Cancelled',
    currentStage: 'Scheme Design',
    stageCompletion: 15,
    clientApprovalStatus: 'Not Submitted',
    nextActionRequired: 'Project cancelled by client',
    ceoMdReview: 'Closed',
    priority: 'Low',
    invoiceStatus: 'Retention Refund Pending',
    estimatedCompletion: 15,
    recv: 0,
    balance: 280,
    engineerEmail: 'karthik@zerowall.app',
  },
  {
    sNo: 8,
    projectName: 'HMR Food Processing Unit',
    clientName: 'HMR Foods Pvt Ltd',
    companySegment: 'Manufacturing',
    projectType: ['PEB + Structural'],
    location: 'Trichy',
    startDate: new Date('2025-05-01'),
    targetDate: new Date('2025-11-30'),
    projectValue: 165,
    overallStatus: 'In Progress',
    currentStage: 'Concept Design',
    stageCompletion: 10,
    clientApprovalStatus: 'In Review',
    clientApprovalDate: new Date('2025-05-18'),
    nextActionRequired: 'Present revised scheme to MD',
    ceoMdReview: 'Pending',
    priority: 'High',
    invoiceStatus: 'LOI Received',
    estimatedCompletion: 10,
    recv: 0,
    balance: 165,
    engineerEmail: 'arjun@zerowall.app',
  },
];

const stageSeeds = [
  {
    projectKey: 'ravi',
    stageNo: 'Stage 1',
    stageName: 'Concept Design',
    stageDescription: 'Initial concept, brief study, site analysis',
    stageStart: new Date('2025-01-01'),
    stageEndPlanned: new Date('2025-01-20'),
    stageEndActual: new Date('2025-01-18'),
    stageStatus: 'Completed',
    deliverable: 'Concept Report',
    submittedToClientOn: new Date('2025-01-18'),
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-01-22'),
    clientComments: 'Approved as submitted',
    nextAction: 'Proceed to Scheme Design',
    completionPct: 100,
  },
  {
    projectKey: 'ravi',
    stageNo: 'Stage 2',
    stageName: 'Scheme Design',
    stageDescription: 'Schematic plans, elevations, sections',
    stageStart: new Date('2025-01-23'),
    stageEndPlanned: new Date('2025-02-15'),
    stageEndActual: new Date('2025-02-14'),
    stageStatus: 'Completed',
    deliverable: 'Scheme Design Package',
    submittedToClientOn: new Date('2025-02-14'),
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-02-20'),
    clientComments: 'Minor changes in elevation',
    nextAction: 'Issue for Prelim. Design',
    completionPct: 100,
  },
  {
    projectKey: 'ravi',
    stageNo: 'Stage 3',
    stageName: 'Preliminary Design',
    stageDescription: 'Detailed drawings, structural coordination',
    stageStart: new Date('2025-02-21'),
    stageEndPlanned: new Date('2025-03-20'),
    stageEndActual: new Date('2025-03-22'),
    stageStatus: 'Completed',
    deliverable: 'Prelim. Drawing Set',
    submittedToClientOn: new Date('2025-03-22'),
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-03-28'),
    clientComments: 'Client approved with comments',
    nextAction: 'Proceed to Working Dwgs',
    completionPct: 100,
  },
  {
    projectKey: 'ravi',
    stageNo: 'Stage 4',
    stageName: 'Working Drawings',
    stageDescription: 'Construction drawings, GFC package',
    stageStart: new Date('2025-04-01'),
    stageEndPlanned: new Date('2025-04-30'),
    stageStatus: 'In Progress',
    deliverable: 'WD Package (65%)',
    clientApprovalStatus: 'Pending',
    nextAction: 'Complete remaining WD; Submit by 05-May',
    completionPct: 65,
  },
  {
    projectKey: 'apex',
    stageNo: 'Stage 1',
    stageName: 'Concept Design',
    stageStart: new Date('2025-04-01'),
    stageEndPlanned: new Date('2025-04-15'),
    stageEndActual: new Date('2025-04-14'),
    stageStatus: 'Completed',
    deliverable: 'Concept Brief',
    submittedToClientOn: new Date('2025-04-14'),
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2025-04-18'),
    clientComments: 'Proceed as discussed',
    nextAction: 'Stage 2 initiated',
    completionPct: 100,
  },
  {
    projectKey: 'apex',
    stageNo: 'Stage 3',
    stageName: 'Detailed Engineering',
    stageDescription: 'Structural analysis, load calculations, drawings',
    stageStart: new Date('2025-05-11'),
    stageEndPlanned: new Date('2025-06-10'),
    stageStatus: 'In Progress',
    deliverable: 'Interim Calc. Pack.',
    clientApprovalStatus: 'In Review',
    nextAction: 'Finalise column layout; MD to review',
    completionPct: 30,
  },
  {
    projectKey: 'surya',
    stageNo: 'Stage 3',
    stageName: 'Panel Schedule & Drawings',
    stageDescription: 'Panel schedule, cable schedule, layout drawings',
    stageStart: new Date('2025-04-16'),
    stageEndPlanned: new Date('2025-05-30'),
    stageStatus: 'In Progress',
    deliverable: 'Panel Sch. (55%)',
    clientApprovalStatus: 'Pending',
    nextAction: 'Submit panel sched. draft by 30-May',
    completionPct: 55,
  },
  {
    projectKey: 'corom',
    stageNo: 'Stage 1',
    stageName: 'Concept Design',
    stageStart: new Date('2024-11-01'),
    stageEndPlanned: new Date('2024-11-20'),
    stageEndActual: new Date('2024-11-18'),
    stageStatus: 'Completed',
    deliverable: 'Concept Report',
    submittedToClientOn: new Date('2024-11-18'),
    clientApprovalStatus: 'Approved',
    clientApprovalDate: new Date('2024-11-22'),
    clientComments: 'Approved',
    completionPct: 100,
  },
];

const taskSeeds = [
  {
    title: 'Finalise column layout with client',
    description: 'Finalise column grid and structural scheme - CEO to review',
    projectKey: 'apex',
    assigneeEmail: 'priya@zerowall.app',
    priority: 'Critical',
    status: 'in-progress',
    dueDate: new Date('2025-05-25'),
  },
  {
    title: 'Present revised PEB scheme to MD',
    description: 'Decision on revised scheme concept',
    projectKey: 'hmr',
    assigneeEmail: 'arjun@zerowall.app',
    priority: 'High',
    status: 'in-progress',
    dueDate: new Date('2025-05-28'),
  },
  {
    title: 'Submit GFC drawings for client confirmation',
    description: 'Approve for client submission',
    projectKey: 'ravi',
    assigneeEmail: 'arjun@zerowall.app',
    priority: 'High',
    status: 'in-progress',
    dueDate: new Date('2025-05-05'),
  },
  {
    title: 'Follow up on plot layout confirmation',
    description: 'CEO to call client for decision',
    projectKey: 'green',
    assigneeEmail: 'arjun@zerowall.app',
    priority: 'Medium',
    status: 'todo',
    dueDate: new Date('2025-05-30'),
  },
  {
    title: 'Submit final invoice',
    description: 'Approve and release invoice',
    projectKey: 'corom',
    assigneeEmail: 'karthik@zerowall.app',
    priority: 'Medium',
    status: 'todo',
    dueDate: new Date('2025-05-25'),
  },
  {
    title: 'Process retention / advance refund',
    description: 'CEO to decide on refund amount',
    projectKey: 'lotus',
    assigneeEmail: 'karthik@zerowall.app',
    priority: 'Low',
    status: 'todo',
    dueDate: new Date('2025-05-31'),
  },
];

const actionItemSeeds = [
  { n: 1, proj: 'Ravi Residency Complex', client: 'Mr. Ravi Kumar', status: 'In Progress', pri: 'high', stage: 'Working Drawings', action: 'Submit GFC Drawings', resp: 'Arjun Mehta', target: new Date('2025-05-05'), decision: 'Review pending' },
  { n: 2, proj: 'Sri Sai Commercial Plaza', client: 'M/s Sri Sai Builders', status: 'In Progress', pri: 'high', stage: 'Structural Design', action: 'Obtain soil report', resp: 'Priya Sharma', target: new Date('2025-05-10'), decision: 'Client follow-up' },
  { n: 3, proj: 'Coromandel Warehouse', client: 'M/s PQR Logistics', status: 'Completed', pri: 'medium', stage: 'As-Built Drawings', action: 'Final invoice submission', resp: 'Karthik Rao', target: new Date('2025-04-30'), decision: 'Closed' },
  { n: 4, proj: 'Green Valley Villas Ph.2', client: 'Mr. Suresh Nair', status: 'On Hold', pri: 'medium', stage: 'Concept Design', action: 'Client confirm revised layout', resp: 'Arjun Mehta', target: new Date('2025-05-15'), decision: 'Escalation' },
  { n: 5, proj: 'Apex Auto Factory', client: 'Apex Auto Parts Ltd.', status: 'In Progress', pri: 'critical', stage: 'Detailed Engineering', action: 'Finalise column layout with client', resp: 'Priya Sharma', target: new Date('2025-05-25'), decision: 'CEO review' },
  { n: 6, proj: 'HMR Food Processing Unit', client: 'HMR Foods Pvt Ltd', status: 'In Progress', pri: 'high', stage: 'Concept Design', action: 'Present revised scheme to MD', resp: 'Arjun Mehta', target: new Date('2025-05-28'), decision: 'MD approval' },
];

function hashlessPassword(user) {
  user.password = 'Password@123';
}

function aliasProjectKey(name) {
  const map = {
    'Ravi Residency Complex': 'ravi',
    'Sri Sai Commercial Plaza': 'sri',
    'Coromandel Warehouse': 'corom',
    'Green Valley Villas Ph.2': 'green',
    'Apex Auto Factory': 'apex',
    'Surya Pharma Plant': 'surya',
    'Lotus IT Park': 'lotus',
    'HMR Food Processing Unit': 'hmr',
  };
  return map[name];
}

function buildActivitySeeds({ actorId, projects = [], stages = [], tasks = [], invoices = [] }) {
  const logs = [];

  for (const project of projects) {
    const projectName = project.projectName || project.name || 'Project';
    logs.push({
      actor: actorId,
      action: 'project_created',
      entityType: 'project',
      entityId: String(project._id),
      project: project._id,
      title: 'Project record created',
      detail: `${projectName} was added to the portfolio.`,
      tone: 'sky',
      link: `/projects/${project._id}`,
      metadata: { projectName },
      occurredAt: project.createdAt || new Date(),
    });

    if (project.updatedAt && project.createdAt && String(project.updatedAt) !== String(project.createdAt)) {
      logs.push({
        actor: actorId,
        action: 'project_updated',
        entityType: 'project',
        entityId: String(project._id),
        project: project._id,
        title: 'Project details updated',
        detail: `Latest changes were saved for ${projectName}.`,
        tone: 'blue',
        link: `/projects/${project._id}`,
        metadata: { projectName },
        occurredAt: project.updatedAt,
      });
    }
  }

  for (const stage of stages) {
    const projectId = stage.project?._id || stage.project || null;
    const projectName = stage.project?.projectName || 'Project';
    logs.push({
      actor: actorId,
      action: 'stage_created',
      entityType: 'stage',
      entityId: String(stage._id),
      project: projectId,
      title: `${stage.stageName || 'Stage'} added`,
      detail: stage.stageDescription || 'A project stage was created.',
      tone: 'emerald',
      link: projectId ? `/projects/${projectId}` : '',
      metadata: { projectName, stageName: stage.stageName || '' },
      occurredAt: stage.createdAt || new Date(),
    });

    if (stage.approvedAt || stage.clientApprovalDate) {
      logs.push({
        actor: actorId,
        action: 'stage_approved',
        entityType: 'stage',
        entityId: String(stage._id),
        project: projectId,
        title: `${stage.stageName || 'Stage'} approval`,
        detail: stage.clientApprovalStatus ? `${stage.clientApprovalStatus} recorded.` : 'Approval recorded.',
        tone: 'emerald',
        link: projectId ? `/projects/${projectId}` : '',
        metadata: { projectName, stageName: stage.stageName || '' },
        occurredAt: stage.approvedAt || stage.clientApprovalDate || stage.updatedAt || new Date(),
      });
    }
  }

  for (const task of tasks) {
    const projectId = task.project?._id || task.project || null;
    const projectName = task.project?.projectName || task.projectName || 'Project';
    logs.push({
      actor: actorId,
      action: 'task_created',
      entityType: 'task',
      entityId: String(task._id),
      project: projectId,
      title: `Task created: ${task.title || 'Untitled task'}`,
      detail: task.description || 'A new task was added to the project.',
      tone: 'sky',
      link: projectId ? `/projects/${projectId}` : '',
      metadata: { projectName, taskTitle: task.title || '' },
      occurredAt: task.createdAt || new Date(),
    });

    if (task.completedAt) {
      logs.push({
        actor: actorId,
        action: 'task_completed',
        entityType: 'task',
        entityId: String(task._id),
        project: projectId,
        title: `Task updated: ${task.title || 'Untitled task'}`,
        detail: `${task.assignee?.name || 'The assignee'} updated the task.`,
        tone: 'emerald',
        link: projectId ? `/projects/${projectId}` : '',
        metadata: { projectName, taskTitle: task.title || '' },
        occurredAt: task.completedAt || task.updatedAt || new Date(),
      });
    }
  }

  for (const invoice of invoices) {
    const projectId = invoice.project?._id || invoice.project || null;
    const projectName = invoice.project?.projectName || 'Project';
    logs.push({
      actor: actorId,
      action: 'invoice_created',
      entityType: 'invoice',
      entityId: String(invoice._id),
      project: projectId,
      title: 'Invoice created',
      detail: `${invoice.invoiceNo || 'Invoice'} was generated for billing review.`,
      tone: 'violet',
      link: '/billing',
      metadata: { projectName, invoiceNo: invoice.invoiceNo || '' },
      occurredAt: invoice.createdAt || new Date(),
    });
  }

  return logs;
}

async function seedActivityLogs({ actorId, projects = [], stages = [], tasks = [], invoices = [] }) {
  const logs = buildActivitySeeds({ actorId, projects, stages, tasks, invoices });
  if (!logs.length) return 0;
  const existing = await ActivityLog.countDocuments({});
  if (existing > 0) return existing;
  await ActivityLog.insertMany(logs);
  return logs.length;
}

async function seed() {
  await connectDB();

  const existingCount = await User.countDocuments();
  const existingActivityCount = await ActivityLog.countDocuments();
  if (existingCount > 0) {
    if (existingActivityCount === 0) {
      const [projects, stages, tasks, invoices, mdUser] = await Promise.all([
        Project.find({})
          .populate('responsibleEngineer', 'name email role avatar employeeId designation department')
          .populate('assignedTeam', 'name email role avatar employeeId designation department')
          .populate('createdBy', 'name email role avatar employeeId designation department'),
        Stage.find({}).populate('project', 'projectName clientName'),
        Task.find({})
          .populate('project', 'projectName clientName')
          .populate('assignee', 'name email role avatar employeeId designation department'),
        Invoice.find({}).populate('project', 'projectName clientName'),
        User.findOne({ email: 'superadmin@zerowall.app' }).select('_id'),
      ]);
      await seedActivityLogs({
        actorId: mdUser?._id || null,
        projects,
        stages,
        tasks,
        invoices,
      });
      console.log(`Database already seeded (${existingCount} users found). Added activity trail records.`);
    } else {
      console.log(`Database already seeded (${existingCount} users found). Skipping. To reseed, drop the database and run again.`);
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Project.deleteMany({}),
    Stage.deleteMany({}),
    Task.deleteMany({}),
    ActionItem.deleteMany({}),
    TeamMember.deleteMany({}),
    TimerLog.deleteMany({}),
    Invoice.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  for (const item of seedUsers) {
    const user = new User({
      name: item.name,
      email: item.email,
      role: item.role,
      designation: item.designation,
      department: item.department,
      phone: item.phone,
      isActive: true,
    });
    hashlessPassword(user);
    await user.save();
  }

  const users = await User.find({});
  const byEmail = new Map(users.map((user) => [user.email, user]));
  const mdUserId = byEmail.get('superadmin@zerowall.app')?._id || null;

  const createdProjects = [];
  for (const project of projectSeeds) {
    const doc = await Project.create({
      ...project,
      responsibleEngineer: byEmail.get(project.engineerEmail)?._id || null,
      createdBy: mdUserId,
    });
    createdProjects.push(doc);
  }

  const projectMap = new Map(
    createdProjects.map((project) => [aliasProjectKey(project.projectName), project]),
  );

  for (const stage of stageSeeds) {
    const project = projectMap.get(stage.projectKey);
    if (!project) continue;
    await Stage.create({
      project: project._id,
      stageNo: stage.stageNo,
      stageName: stage.stageName,
      stageDescription: stage.stageDescription || '',
      stageStart: stage.stageStart,
      stageEndPlanned: stage.stageEndPlanned,
      stageEndActual: stage.stageEndActual,
      stageStatus: stage.stageStatus,
      deliverable: stage.deliverable || '',
      submittedToClientOn: stage.submittedToClientOn,
      clientApprovalStatus: stage.clientApprovalStatus || 'Not Submitted',
      clientApprovalDate: stage.clientApprovalDate,
      clientComments: stage.clientComments || '',
      nextAction: stage.nextAction || '',
      completionPct: stage.completionPct || 0,
    });
  }

  const createdTasks = [];
  for (const task of taskSeeds) {
    const project = projectMap.get(task.projectKey);
    if (!project) continue;
    const createdTask = await Task.create({
      title: task.title,
      description: task.description,
      project: project._id,
      assignee: byEmail.get(task.assigneeEmail)?._id || null,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      createdBy: byEmail.get('superadmin@zerowall.app')?._id || null,
    });
    createdTasks.push(createdTask);
  }

  const taskMapByTitle = new Map(createdTasks.map((task) => [task.title, task]));
  const timerSeeds = [
    {
      userEmail: 'arjun@zerowall.app',
      taskTitle: 'Submit GFC drawings for client confirmation',
      projectKey: 'ravi',
      duration: 10800,
      note: 'Working drawings progress',
      daysAgo: 2,
      hoursAgo: 3,
    },
    {
      userEmail: 'priya@zerowall.app',
      taskTitle: 'Finalise column layout with client',
      projectKey: 'apex',
      duration: 14400,
      note: 'Column layout review',
      daysAgo: 1,
      hoursAgo: 4,
    },
    {
      userEmail: 'karthik@zerowall.app',
      taskTitle: 'Submit final invoice',
      projectKey: 'corom',
      duration: 7200,
      note: 'Invoice follow-up',
      daysAgo: 3,
      hoursAgo: 2,
    },
    {
      userEmail: 'dinesh@zerowall.app',
      taskTitle: 'Present revised PEB scheme to MD',
      projectKey: 'hmr',
      duration: 5400,
      note: 'Scheme presentation prep',
      daysAgo: 4,
      hoursAgo: 1,
    },
    {
      userEmail: 'arjun@zerowall.app',
      taskTitle: 'Follow up on plot layout confirmation',
      projectKey: 'green',
      duration: 3600,
      note: 'Client coordination',
      daysAgo: 5,
      hoursAgo: 1,
    },
    {
      userEmail: 'priya@zerowall.app',
      taskTitle: 'Finalise column layout with client',
      projectKey: 'apex',
      duration: 9000,
      note: 'Rework based on feedback',
      daysAgo: 5,
      hoursAgo: 2,
    },
  ];

  for (const entry of timerSeeds) {
    const task = taskMapByTitle.get(entry.taskTitle);
    const user = byEmail.get(entry.userEmail);
    const project = projectMap.get(entry.projectKey);
    if (!task || !user || !project) continue;

    const endTime = new Date();
    endTime.setDate(endTime.getDate() - entry.daysAgo);
    endTime.setHours(Math.max(0, endTime.getHours() - entry.hoursAgo), 0, 0, 0);
    const startTime = new Date(endTime.getTime() - entry.duration * 1000);
    const date = new Date(endTime);
    date.setHours(0, 0, 0, 0);

    await TimerLog.create({
      user: user._id,
      task: task._id,
      project: project._id,
      startTime,
      endTime,
      duration: entry.duration,
      note: entry.note,
      date,
      isManual: false,
      isActive: false,
    });

    task.totalTimeLogged = Number(task.totalTimeLogged || 0) + entry.duration;
    await task.save();
  }

  const invoiceSeeds = [
    {
      projectKey: 'ravi',
      invoiceNo: 'ZW-INV-001',
      billingStatus: '50% Received',
      amountTotal: 42.5,
      amountReceived: 21.25,
      balance: 21.25,
      remarks: 'Balance on GFC approval',
    },
    {
      projectKey: 'sri',
      invoiceNo: 'ZW-INV-002',
      billingStatus: 'Advance Received',
      amountTotal: 87,
      amountReceived: 10,
      balance: 77,
      remarks: 'Soil report pending - hold billing',
    },
    {
      projectKey: 'corom',
      invoiceNo: 'ZW-INV-003',
      billingStatus: 'Final Invoice Pending',
      amountTotal: 120,
      amountReceived: 96,
      balance: 24,
      remarks: 'Final invoice to be submitted',
    },
    {
      projectKey: 'apex',
      invoiceNo: 'ZW-INV-004',
      billingStatus: 'Mobilisation Advance Received',
      amountTotal: 345,
      amountReceived: 50,
      balance: 295,
      remarks: 'Major value - milestone billing planned',
    },
    {
      projectKey: 'surya',
      invoiceNo: 'ZW-INV-005',
      billingStatus: '1st Running Bill Submitted',
      amountTotal: 58,
      amountReceived: 25,
      balance: 33,
      remarks: 'Awaiting bill payment',
    },
    {
      projectKey: 'hmr',
      invoiceNo: 'ZW-INV-006',
      billingStatus: 'LOI Received',
      amountTotal: 165,
      amountReceived: 15,
      balance: 150,
      remarks: 'PEB milestone-based billing',
    },
  ];

  for (const invoiceSeed of invoiceSeeds) {
    const project = projectMap.get(invoiceSeed.projectKey);
    if (!project) continue;

    await Invoice.create({
      project: project._id,
      invoiceNo: invoiceSeed.invoiceNo,
      billingStatus: invoiceSeed.billingStatus,
      amountTotal: invoiceSeed.amountTotal,
      amountReceived: invoiceSeed.amountReceived,
      balance: invoiceSeed.balance,
      remarks: invoiceSeed.remarks,
      createdBy: mdUserId,
    });

    project.invoiceStatus = invoiceSeed.billingStatus;
    project.recv = invoiceSeed.amountReceived;
    project.balance = invoiceSeed.balance;
    await project.save();
  }

  for (const item of actionItemSeeds) {
    await ActionItem.create(item);
  }

  const workloadMap = new Map([
    ['Arjun Mehta', 2],
    ['Priya Sharma', 2],
    ['Karthik Rao', 2],
    ['Dinesh Kumar', 1],
  ]);

  for (const [name, projectsCount] of workloadMap.entries()) {
    await TeamMember.create({
      initials: name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      name,
      role: 'Engineer',
      projects: projectsCount,
      color: '#2E83F5',
      online: true,
    });
  }

  const raviId = projectMap.get('ravi')?._id;
  const apexId = projectMap.get('apex')?._id;
  const taskByTitle = new Map(createdTasks.map((task) => [task.title, task]));
  const task3Id = taskByTitle.get('Submit GFC drawings for client confirmation')?._id;
  const task1Id = taskByTitle.get('Finalise column layout with client')?._id;
  const arjunId = byEmail.get('arjun@zerowall.app')?._id;
  const priyaId = byEmail.get('priya@zerowall.app')?._id;

  await Notification.create([
    {
      recipient: arjunId,
      sender: mdUserId,
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: 'MD assigned you "Submit GFC drawings"',
      link: '/my-tasks',
      isRead: false,
      metadata: {
        taskId: task3Id,
        projectId: raviId,
      },
    },
    {
      recipient: priyaId,
      sender: mdUserId,
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: 'MD assigned you "Finalise column layout"',
      link: '/my-tasks',
      isRead: false,
      metadata: {
        taskId: task1Id,
        projectId: apexId,
      },
    },
    {
      recipient: arjunId,
      sender: mdUserId,
      type: 'stage_approved',
      title: 'Stage Approved',
      message: 'Scheme Design has been approved for Ravi Residency Complex',
      link: `/projects/${raviId}`,
      isRead: true,
    },
    {
      recipient: mdUserId,
      sender: arjunId,
      type: 'task_status_changed',
      title: 'Task Updated',
      message: 'Arjun S. updated "Submit GFC drawings" to in-progress',
      link: `/projects/${raviId}`,
      isRead: false,
    },
  ]);

  await seedActivityLogs({
    actorId: mdUserId,
    projects: createdProjects,
    stages: await Stage.find({ project: { $in: createdProjects.map((project) => project._id) } }).populate('project', 'projectName clientName'),
    tasks: await Task.find({ project: { $in: createdProjects.map((project) => project._id) } })
      .populate('project', 'projectName clientName')
      .populate('assignee', 'name email role avatar employeeId designation department'),
    invoices: await Invoice.find({ project: { $in: createdProjects.map((project) => project._id) } }).populate('project', 'projectName clientName'),
  });

  console.log('Seed complete — ZEROWALL is ready!');
  console.log(`Users: ${users.length} | Projects: ${createdProjects.length} | Stages: ${stageSeeds.length} | Tasks: ${taskSeeds.length} | TimerLogs: ${timerSeeds.length} | Invoices: ${invoiceSeeds.length} | Notifications: 4`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
