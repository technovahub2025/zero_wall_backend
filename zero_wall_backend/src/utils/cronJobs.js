const cron = require('node-cron');
const Task = require('../models/Task');
const User = require('../models/User');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const { createNotification } = require('./createNotification');
const { sendEmail } = require('./sendEmail');
const { runOverdueCheck } = require('./overdueChecker');

function weeklySummaryTemplate({ adminName, activeProjects, overdueTaskCount, projectList }) {
  const rows = projectList
    .map(
      (project) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #173149;color:#F0F4FA">${project.projectName || ''}</td>
          <td style="padding:10px 0;border-bottom:1px solid #173149;color:#8FA8C8">${project.currentStage || ''}</td>
          <td style="padding:10px 0;border-bottom:1px solid #173149;color:#2E83F5">${project.overallStatus || ''}</td>
        </tr>`,
    )
    .join('');

  return `
    <div style="background:#0B1929;padding:40px;font-family:sans-serif;color:#F0F4FA">
      <h1 style="color:#2E83F5;font-size:24px">PG Infrastructure</h1>
      <p style="color:#8FA8C8;font-size:13px;margin-bottom:24px">Project execution and reporting.</p>
      <h2 style="color:#F0F4FA;font-size:18px">Weekly Summary</h2>
      <p style="color:#8FA8C8">Hi ${adminName}, here's your week in review.</p>
      <div style="display:flex;gap:16px;margin:20px 0">
        <div style="background:#0F2236;padding:16px;border-radius:8px;flex:1;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#2E83F5">${activeProjects}</div>
          <div style="color:#8FA8C8;font-size:12px">Active Projects</div>
        </div>
        <div style="background:#0F2236;padding:16px;border-radius:8px;flex:1;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#F0A428">${overdueTaskCount}</div>
          <div style="color:#8FA8C8;font-size:12px">Overdue Tasks</div>
        </div>
      </div>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
        <thead>
          <tr>
            <th align="left" style="padding-bottom:12px;color:#8FA8C8;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Project</th>
            <th align="left" style="padding-bottom:12px;color:#8FA8C8;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Stage</th>
            <th align="left" style="padding-bottom:12px;color:#8FA8C8;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Status</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="3" style="color:#8FA8C8;padding:12px 0">No active projects.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

async function sendDueSoonReminders() {
  const soon = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const dueSoonTasks = await Task.find({
    status: { $ne: 'done' },
    dueDate: { $gte: new Date(), $lte: soon },
  }).populate('assignee project');

  for (const task of dueSoonTasks) {
    if (!task.assignee?.isActive) continue;

    const existing = await Notification.findOne({
      recipient: task.assignee._id,
      type: 'task_due_soon',
      'metadata.taskId': task._id,
      createdAt: { $gte: new Date(Date.now() - 20 * 60 * 60 * 1000) },
    });
    if (existing) continue;

    const hoursLeft = Math.max(0, Math.floor((new Date(task.dueDate).getTime() - Date.now()) / (60 * 60 * 1000)));

    await createNotification({
      recipient: task.assignee._id,
      type: 'task_due_soon',
      title: 'Task Due Soon',
      message: `"${task.title}" is due in ${hoursLeft} hours`,
      link: '/my-tasks',
      metadata: {
        taskId: task._id,
        taskTitle: task.title,
        projectId: task.project?._id,
        projectName: task.project?.projectName,
      },
    });
  }
}

async function sendWeeklySummaries() {
  const admins = await User.find({
    role: { $in: ['superadmin', 'admin'] },
    isActive: true,
  });
  const projects = await Project.find({ overallStatus: 'In Progress' }).populate('responsibleEngineer', 'name');
  const overdueTasks = await Task.find({ status: { $ne: 'done' }, dueDate: { $lt: new Date() } });

  for (const admin of admins) {
    await sendEmail({
      to: admin.email,
      subject: 'PG Infrastructure - Weekly Project Summary',
      html: weeklySummaryTemplate({
        adminName: admin.name,
        activeProjects: projects.length,
        overdueTaskCount: overdueTasks.length,
        projectList: projects.slice(0, 5),
      }),
    });
  }
}

async function cleanupExpiredInvites() {
  const expiredCount = await User.countDocuments({
    inviteExpiry: { $lt: new Date() },
    inviteToken: { $exists: true, $ne: null },
  });

  if (expiredCount > 0) {
    console.log(`Expired invites found: ${expiredCount} (cleanup disabled; manual handling only)`);
  }
}

async function archiveCompletedProjects() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);

  const result = await Project.updateMany(
    {
      overallStatus: 'Completed',
      updatedAt: { $lt: cutoff },
      isArchived: false,
    },
    { isArchived: true },
  );

  if (result.modifiedCount > 0) {
    console.log(`Auto-archived ${result.modifiedCount} projects`);
  }
}

function startCronJobs() {
  cron.schedule('0 8 * * *', async () => {
    console.log('Running overdue task checker...');
    try {
      await runOverdueCheck();
    } catch (error) {
      console.error('Overdue cron error:', error);
    }
  });

  cron.schedule('0 9 * * *', async () => {
    console.log('Running due-soon checker...');
    try {
      await sendDueSoonReminders();
    } catch (error) {
      console.error('Due-soon cron error:', error);
    }
  });

  cron.schedule('0 7 * * 1', async () => {
    console.log('Sending weekly summaries...');
    try {
      await sendWeeklySummaries();
    } catch (error) {
      console.error('Weekly email cron error:', error);
    }
  });

  cron.schedule('0 0 * * *', async () => {
    try {
      await cleanupExpiredInvites();
    } catch (error) {
      console.error('Invite cleanup error:', error);
    }
  });

  cron.schedule('0 1 1 * *', async () => {
    try {
      await archiveCompletedProjects();
    } catch (error) {
      console.error('Archive cron error:', error);
    }
  });

  console.log('All cron jobs started');
}

module.exports = {
  startCronJobs,
  weeklySummaryTemplate,
};
