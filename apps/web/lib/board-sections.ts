type BoardItem = {
  id: string;
  name: string;
  kind?: "structural" | "event" | null;
  parentDefinitionId?: string | null;
  parentName?: string | null;
  attentionZScore: number;
  zScore: number;
  storyBreadth: number;
};

export type EventGroup<T extends BoardItem> = {
  key: string;
  parentId: string | null;
  parentName: string | null;
  items: T[];
};

export type BoardSections<T extends BoardItem> = {
  structural: T[];
  eventGroups: EventGroup<T>[];
  eventCount: number;
};

function bySurprise<T extends BoardItem>(left: T, right: T) {
  return (
    right.attentionZScore - left.attentionZScore ||
    right.zScore - left.zScore ||
    right.storyBreadth - left.storyBreadth ||
    left.name.localeCompare(right.name)
  );
}

/**
 * Structural themes are the primary section. Event narratives are nested under
 * their parent family when they have one; the rest form a trailing
 * "standalone" group. Groups are ordered by their most surprising member so
 * the section still reads top-down.
 */
export function groupBoard<T extends BoardItem>(narratives: T[]): BoardSections<T> {
  const structural = narratives
    .filter((item) => (item.kind ?? "structural") === "structural")
    .sort(bySurprise);
  const events = narratives.filter((item) => item.kind === "event");
  const groups = new Map<string, EventGroup<T>>();
  for (const item of events) {
    const parentId = item.parentDefinitionId ?? null;
    const key = parentId ?? "standalone";
    const group = groups.get(key) ?? {
      key,
      parentId,
      parentName: parentId ? item.parentName ?? null : null,
      items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  const eventGroups = [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort(bySurprise) }))
    .sort((left, right) => {
      if (left.parentId === null) return 1;
      if (right.parentId === null) return -1;
      return bySurprise(left.items[0], right.items[0]);
    });
  return { structural, eventGroups, eventCount: events.length };
}
