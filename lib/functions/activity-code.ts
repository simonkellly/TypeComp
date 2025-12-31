export interface ParsedActivityCode {
  eventId: string;
  roundNumber: number | null;
  groupNumber: number | null;
  attemptNumber: number | null;
}

export function parseActivityCode(code: string): ParsedActivityCode | null {
  const codeSplit = code.split('-');

  if (codeSplit[0] === 'other') {
    return null;
  }

  const eventId = codeSplit[0];
  let roundNumber: number | null = null;
  let groupNumber: number | null = null;
  let attemptNumber: number | null = null;

  for (let i = 1; i < codeSplit.length; i++) {
    const part = codeSplit[i];

    if (!part) {
      continue;
    }
    if (part.startsWith('r')) {
      roundNumber = parseInt(part.slice(1), 10);
    } else if (part.startsWith('g')) {
      groupNumber = parseInt(part.slice(1), 10);
    } else if (part.startsWith('a')) {
      attemptNumber = parseInt(part.slice(1), 10);
    }
  }

  return {
    eventId: eventId || '',
    roundNumber,
    groupNumber,
    attemptNumber,
  };
}

export function activityCodeContains(
  container: ParsedActivityCode,
  contained: ParsedActivityCode,
): boolean {
  if (container.eventId !== contained.eventId) {
    return false;
  }
  if (
    container.roundNumber !== null &&
    container.roundNumber !== contained.roundNumber
  ) {
    return false;
  }
  if (
    container.groupNumber !== null &&
    container.groupNumber !== contained.groupNumber
  ) {
    return false;
  }

  return true;
}

export function formatActivityCode(code: ParsedActivityCode): string {
  const parts = [code.eventId];

  if (code.roundNumber !== null) {
    parts.push(`r${code.roundNumber}`);
  }
  if (code.groupNumber !== null) {
    parts.push(`g${code.groupNumber}`);
  }
  if (code.attemptNumber !== null) {
    parts.push(`a${code.attemptNumber}`);
  }

  return parts.join('-');
}
