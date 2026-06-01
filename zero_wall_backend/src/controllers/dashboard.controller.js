const Project = require('../models/Project');
const ActionItem = require('../models/ActionItem');
const TeamMember = require('../models/TeamMember');
const StageLog = require('../models/StageLog');
const asyncHandler = require('../utils/asyncHandler');

function buildKpis(projects, actions) {
  const totalProjects = projects.length;
  const inProgress = projects.filter((project) => project.status === 'progress').length;
  const completed = projects.filter((project) => project.status === 'done').length;
  const onHold = projects.filter((project) => project.status === 'hold').length;
  const cancelled = projects.filter((project) => project.status === 'cancelled').length;
  const critical = projects.filter((project) => project.priority === 'critical').length;
  const avgCompletion = totalProjects
    ? Math.round(projects.reduce((sum, project) => sum + Number(project.completion || 0), 0) / totalProjects)
    : 0;

  return [
    { label: 'Total Projects', value: totalProjects, tone: 'blue', note: 'Active portfolio' },
    { label: 'In Progress', value: inProgress, tone: 'sky', note: 'Active now' },
    { label: 'Completed', value: completed, tone: 'emerald', note: 'This cycle' },
    { label: 'On Hold', value: onHold, tone: 'amber', note: 'Awaiting' },
    { label: 'Cancelled', value: cancelled, tone: 'rose', note: 'Terminated' },
    { label: 'Critical', value: critical, tone: 'rose', note: 'Needs action' },
    { label: 'Avg Completion', value: `${avgCompletion}%`, tone: 'amber', note: 'Portfolio avg' },
    { label: 'Action Items', value: actions.length, tone: 'blue', note: 'Open decisions' },
  ];
}

const overview = asyncHandler(async (req, res) => {
  const [projects, actions, team, stages] = await Promise.all([
    Project.find().sort({ createdAt: -1 }),
    ActionItem.find().sort({ target: 1 }),
    TeamMember.find().sort({ name: 1 }),
    StageLog.find().sort({ start: 1 }),
  ]);

  const receivedTotal = projects.reduce((sum, project) => sum + Number(project.recv || 0), 0);
  const balanceTotal = projects.reduce((sum, project) => sum + Number(project.balance || 0), 0);
  const totalValue = projects.reduce((sum, project) => sum + Number(project.value || 0), 0);
  const pendingApprovals = projects.filter((project) => ['Pending', 'In Review'].includes(project.approval)).length;

  const revenueSummary = projects.map((project) => ({
    name: project.name,
    received: Number(project.recv || 0),
    balance: Number(project.balance || 0),
  }));

  return res.json({
    success: true,
    data: {
      kpis: buildKpis(projects, actions),
      summary: {
        totalProjects: projects.length,
        inProgress: projects.filter((project) => project.status === 'progress').length,
        completed: projects.filter((project) => project.status === 'done').length,
        openActions: actions.filter((action) => !action.isClosed).length,
        pendingApprovals,
        totalValue,
        receivedTotal,
        balanceTotal,
      },
      projects: projects.map((project) => ({
        id: project._id,
        name: project.name,
        client: project.client,
        type: project.type,
        typeShort: project.typeShort,
        location: project.location,
        start: project.start,
        end: project.end,
        value: project.value,
        status: project.status,
        stage: project.stage,
        completion: project.completion,
        priority: project.priority,
        engineer: project.engineer,
        approval: project.approval,
        billing: project.billing,
        recv: project.recv,
        balance: project.balance,
        stageHistory: project.stageHistory,
      })),
      actions: actions.map((action) => ({
        id: action._id,
        n: action.n,
        proj: action.proj,
        client: action.client,
        status: action.status,
        pri: action.pri,
        stage: action.stage,
        action: action.action,
        resp: action.resp,
        target: action.target,
        decision: action.decision,
      })),
      team: team.map((member) => ({
        id: member._id,
        initials: member.initials,
        name: member.name,
        role: member.role,
        projects: member.projects,
        color: member.color,
        online: member.online,
      })),
      stages: stages.map((stage) => ({
        id: stage._id,
        proj: stage.proj,
        client: stage.client,
        stageNo: stage.stageNo,
        stageName: stage.stageName,
        start: stage.start,
        endPlan: stage.endPlan,
        endActual: stage.endActual,
        status: stage.status,
        deliverable: stage.deliverable,
        approval: stage.approval,
        next: stage.next,
      })),
      revenueSummary,
    },
  });
});

module.exports = {
  overview,
};
