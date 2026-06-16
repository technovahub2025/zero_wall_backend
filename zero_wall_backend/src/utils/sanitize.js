const sanitizeUser = (user) => {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.passwordHash;
  delete obj.inviteToken;
  delete obj.inviteExpiry;
  delete obj.inviteTokenPrevious;
  delete obj.inviteExpiryPrevious;
  delete obj.inviteTokenHistory;
  delete obj.resetToken;
  delete obj.resetExpiry;
  return obj;
};

const sanitizeProjectData = (data) => {
  const allowed = [
    'sNo',
    'projectName',
    'clientName',
    'companySegment',
    'projectType',
    'location',
    'startDate',
    'targetDate',
    'actualEnd',
    'projectValue',
    'overallStatus',
    'currentStage',
    'stageCompletion',
    'clientApprovalStatus',
    'clientApprovalDate',
    'nextActionRequired',
    'responsibleEngineer',
    'assignedTeam',
    'remarks',
    'blockers',
    'remarksOrBlockers',
    'ceoMdReview',
    'priority',
    'invoiceStatus',
    'estimatedCompletion',
    'order',
    'isArchived',
    'createdBy',
    'recv',
    'balance',
  ];

  return Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key)));
};

module.exports = {
  sanitizeUser,
  sanitizeProjectData,
};
