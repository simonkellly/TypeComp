export { STAFF_JOBS as STANDARD_JOB_NAMES } from '../../constants';

export {
  assignAllRounds,
  assignBlindfolded,
  assignGroupifier,
  assignRound,
  assignStaff,
  assignWaveStaff,
  type GroupifierOptions,
  type GroupifierResult,
  type StandardStaffOptions,
} from './assignment';

export {
  type AssignmentSetConfig,
  commentatorsSet,
  dataEntryAssignmentSet,
  getPsychSheetPosition,
  psychSheetAssignmentSets,
  scramblersSet,
  stageLeadsSet,
  topCompetitorsSet,
  volunteersOnStageSet,
} from './assignment-sets';

export {
  type DefaultGroupScorersOptions,
  type DefaultStaffScorersOptions,
  defaultGroupScorers,
  defaultStaffScorers,
  enhancedGroupScorers,
  simpleGroupScorers,
  simpleStaffScorers,
} from './scorers';
