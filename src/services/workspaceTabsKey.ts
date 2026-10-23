/** Where a project's companion-tab layout is remembered (this window's localStorage). Kept apart so deleting a project can drop it. */
export const tabsStorageKey = (projectId: string) => `wh:workspace-tabs:v1:${projectId}`;
