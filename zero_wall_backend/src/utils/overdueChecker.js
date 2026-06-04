const Task = require('../models/Task');
const Notification = require('../models/Notification');
const { createNotification } = require('./createNotification');

async function runOverdueCheck() {
  const overdueTasks = await Task.find({
    status: { $ne: 'done' },
    dueDate: { $lt: new Date() },
  }).populate('assignee project');

  for (const task of overdueTasks) {
    if (!task.assignee) continue;

    const existing = await Notification.findOne({
      recipient: task.assignee._id,
      type: 'task_overdue',
      'metadata.taskId': task._id,
      createdAt: {
        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    if (existing) continue;

    const daysOverdue = Math.max(
      1,
      Math.floor((Date.now() - new Date(task.dueDate).getTime()) / (24 * 60 * 60 * 1000)),
    );

    await createNotification({
      recipient: task.assignee._id,
      type: 'task_overdue',
      title: 'Task Overdue',
      message: `"${task.title}" is ${daysOverdue} day(s) overdue`,
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

function startOverdueChecker() {
  runOverdueCheck().catch((error) => {
    console.error('Overdue checker error:', error);
  });
}

module.exports = {
  startOverdueChecker,
  runOverdueCheck,
};
