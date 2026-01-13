export const GROUPIFIER_EXTENSION_PREFIX = 'groupifier.';

type ExtensibleEntity = {
  extensions?: Array<{ id: string; specUrl?: string; data: unknown }>;
};

export function getExtensionData<T>(
  extensionName: string,
  entity: ExtensibleEntity,
  prefix: string = GROUPIFIER_EXTENSION_PREFIX,
): T | null {
  const fullId = `${prefix}${extensionName}`;
  const extension = (entity.extensions || []).find((ext) => ext.id === fullId);
  return (extension?.data as T) ?? null;
}

export function setExtensionData<T>(
  extensionName: string,
  entity: ExtensibleEntity,
  data: T,
  prefix: string = GROUPIFIER_EXTENSION_PREFIX,
): void {
  const fullId = `${prefix}${extensionName}`;

  if (!entity.extensions) {
    entity.extensions = [];
  }

  const existingIndex = entity.extensions.findIndex((ext) => ext.id === fullId);

  const extension = {
    id: fullId,
    specUrl: `https://groupifier.jonatanklosko.com/wcif-extensions/${extensionName}.json`,
    data,
  };

  if (existingIndex >= 0) {
    entity.extensions[existingIndex] = extension;
  } else {
    entity.extensions.push(extension);
  }
}

export function getOrSetExtensionData<T>(
  extensionName: string,
  entity: ExtensibleEntity,
  defaultValue: T,
  prefix: string = GROUPIFIER_EXTENSION_PREFIX,
): T {
  const existing = getExtensionData<T>(extensionName, entity, prefix);

  if (existing !== null) {
    return existing;
  }

  setExtensionData(extensionName, entity, defaultValue, prefix);
  return defaultValue;
}

export function removeExtensionData(
  extensionName: string,
  entity: ExtensibleEntity,
  prefix: string = GROUPIFIER_EXTENSION_PREFIX,
): void {
  const fullId = `${prefix}${extensionName}`;

  if (!entity.extensions) return;

  entity.extensions = entity.extensions.filter((ext) => ext.id !== fullId);
}

export interface GroupifierCompetitionConfig {
  competitorsSortingRule?:
    | 'ranks'
    | 'balanced'
    | 'symmetric'
    | 'name-optimised';
  noTasksForNewcomers?: boolean;
  tasksForOwnEventsOnly?: boolean;
  noRunningForForeigners?: boolean;
  printStations?: boolean;
}

export interface GroupifierActivityConfig {
  capacity?: number;
  groups?: number;
  scramblers?: number;
  runners?: number;
  assignJudges?: boolean;
}

export interface GroupifierRoomConfig {
  stations?: number;
}

export const DEFAULT_COMPETITION_CONFIG: GroupifierCompetitionConfig = {
  competitorsSortingRule: 'ranks',
  noTasksForNewcomers: false,
  tasksForOwnEventsOnly: false,
  noRunningForForeigners: false,
  printStations: false,
};

export function getCompetitionConfig(
  entity: ExtensibleEntity,
): GroupifierCompetitionConfig {
  const data = getExtensionData<GroupifierCompetitionConfig>(
    'CompetitionConfig',
    entity,
  );
  return { ...DEFAULT_COMPETITION_CONFIG, ...data };
}

export function getActivityConfig(
  entity: ExtensibleEntity,
): GroupifierActivityConfig | null {
  return getExtensionData<GroupifierActivityConfig>('ActivityConfig', entity);
}

export function getRoomConfig(
  entity: ExtensibleEntity,
): GroupifierRoomConfig | null {
  return getExtensionData<GroupifierRoomConfig>('RoomConfig', entity);
}

export const PERSON_EXTENSION_PREFIX = 'org.cubingusa.natshelper.v1.';

export interface PersonExtensionData {
  properties?: Record<string, unknown>;
  staffUnavailable?: unknown;
}

export function getPersonExtension(
  person: ExtensibleEntity,
): PersonExtensionData | null {
  return getExtensionData<PersonExtensionData>(
    'Person',
    person,
    PERSON_EXTENSION_PREFIX,
  );
}

function getOrCreatePersonExtension(
  person: ExtensibleEntity,
): PersonExtensionData {
  const existing = getPersonExtension(person);
  if (existing) return existing;

  const newData: PersonExtensionData = { properties: {} };
  setExtensionData('Person', person, newData, PERSON_EXTENSION_PREFIX);
  return newData;
}

export function getBooleanProperty(
  person: ExtensibleEntity,
  key: string,
): boolean {
  const ext = getPersonExtension(person);
  const value = ext?.properties?.[key];
  return value === true;
}

export function getStringProperty(
  person: ExtensibleEntity,
  key: string,
): string | null {
  const ext = getPersonExtension(person);
  const value = ext?.properties?.[key];
  return typeof value === 'string' ? value : null;
}

export function getNumberProperty(
  person: ExtensibleEntity,
  key: string,
): number | null {
  const ext = getPersonExtension(person);
  const value = ext?.properties?.[key];
  return typeof value === 'number' ? value : null;
}

export function setPersonProperty(
  person: ExtensibleEntity,
  key: string,
  value: boolean | string | number | null,
): void {
  const ext = getOrCreatePersonExtension(person);

  if (!ext.properties) {
    ext.properties = {};
  }

  if (value === null) {
    delete ext.properties[key];
  } else {
    ext.properties[key] = value;
  }

  setExtensionData('Person', person, ext, PERSON_EXTENSION_PREFIX);
}

export function getAllPersonProperties(
  person: ExtensibleEntity,
): Record<string, unknown> {
  const ext = getPersonExtension(person);
  return ext?.properties || {};
}

export function hasPersonProperty(
  person: ExtensibleEntity,
  key: string,
): boolean {
  const ext = getPersonExtension(person);
  return ext?.properties?.[key] !== undefined;
}
