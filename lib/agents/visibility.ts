export function applyAgentVisibilityFilter<T extends { is: (column: string, value: unknown) => T }>(query: T) {
  return query.is('deleted_at', null);
}
