import { ApiError } from '$lib/api/client';
import { errorKey } from '$lib/auth/errors';

/**
 * Business-rule refusals from the projects and time-entries API, as translation keys —
 * the same pattern `$lib/documents/errors.ts` and `$lib/absence/errors.ts` use. Matching
 * on message text is still the weak part: the API has no machine-readable error code to
 * match on instead, so this map is the seam, in one file.
 */
const REFUSALS: { fragment: string; key: string }[] = [
	{ fragment: 'a project with that name already exists', key: 'errors.projectNameTaken' },
	{ fragment: 'a task with that name already exists', key: 'errors.taskNameTaken' },
	{ fragment: 'project not found', key: 'errors.projectNotFound' },
	{ fragment: 'task not found', key: 'errors.taskNotFound' },
	{ fragment: 'that project is retired', key: 'errors.projectRetired' },
	{ fragment: 'that task is retired', key: 'errors.taskRetired' },
	{ fragment: 'you already have a timer running', key: 'errors.timerAlreadyRunning' },
	{ fragment: 'that timer is not running', key: 'errors.timerNotRunning' },
	{ fragment: 'time entry not found', key: 'errors.timeEntryNotFound' },
	{
		fragment: 'give either a duration or a start and end',
		key: 'errors.timeEntryBothDurationAndRange'
	},
	{ fragment: 'duration must be positive', key: 'errors.timeEntryDurationInvalid' },
	{ fragment: 'a start and an end are required', key: 'errors.timeEntryRangeRequired' },
	{ fragment: 'start and end must be valid instants', key: 'errors.timeEntryInvalidInstant' },
	{ fragment: 'the end must follow the start', key: 'errors.timeEntryEndBeforeStart' },
	{ fragment: 'stop the timer before editing', key: 'errors.timeEntryStopTimerFirst' }
];

export function timeEntryErrorKey(error: unknown): string {
	if (error instanceof ApiError) {
		const message = error.message.toLowerCase();
		const known = REFUSALS.find((refusal) => message.includes(refusal.fragment));

		if (known) return known.key;
	}

	return errorKey(error);
}
