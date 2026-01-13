export class TypeCompError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TypeCompError';
  }
}

export function validateRoundId(roundId: string): void {
  const match = roundId.match(/^([a-z0-9]+)-r(\d+)$/);
  if (!match) {
    throw new TypeCompError(
      `Invalid round ID "${roundId}". Expected format: "eventId-rN" (e.g., "333-r1", "pyram-r2", "444bf-r1")`,
      'INVALID_ROUND_ID',
      { roundId },
    );
  }
}

export function validateEventId(eventId: string): void {
  const validEvents = [
    '222',
    '333',
    '444',
    '555',
    '666',
    '777',
    '333bf',
    '333fm',
    '333mbf',
    '333oh',
    '444bf',
    '555bf',
    'clock',
    'minx',
    'pyram',
    'skewb',
    'sq1',
  ];

  if (!validEvents.includes(eventId)) {
    throw new TypeCompError(
      `Invalid event ID "${eventId}". Valid events: ${validEvents.join(', ')}`,
      'INVALID_EVENT_ID',
      { eventId, validEvents },
    );
  }
}

export function validateGroupCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeCompError(
      `Invalid group count "${count}". Must be a positive integer (1 or more)`,
      'INVALID_GROUP_COUNT',
      { count },
    );
  }
}

export function validateMaxGroupSize(size: number): void {
  if (!Number.isInteger(size) || size < 1) {
    throw new TypeCompError(
      `Invalid max group size "${size}". Must be a positive integer (1 or more)`,
      'INVALID_MAX_GROUP_SIZE',
      { size },
    );
  }
}

export function validateTimeString(time: string, fieldName: string): void {
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/;
  const timeOnlyPattern = /^\d{2}:\d{2}(:\d{2})?$/;

  if (!isoPattern.test(time) && !timeOnlyPattern.test(time)) {
    throw new TypeCompError(
      `Invalid ${fieldName} "${time}". Expected ISO format "YYYY-MM-DDTHH:mm:ss" or time-only "HH:mm:ss"`,
      'INVALID_TIME_FORMAT',
      { [fieldName]: time },
    );
  }
}

export function assertExists<T>(
  value: T | null | undefined,
  entityName: string,
  identifier?: string | number,
): asserts value is T {
  if (value === null || value === undefined) {
    const idPart = identifier !== undefined ? ` with ID "${identifier}"` : '';
    throw new TypeCompError(`${entityName}${idPart} not found`, 'NOT_FOUND', {
      entityName,
      identifier,
    });
  }
}
