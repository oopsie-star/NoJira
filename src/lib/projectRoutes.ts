import { useStore } from '@/store'

// The app's project-scoped sections. URLs look like /projects/<KEY>/<section>,
// e.g. /projects/MOMNA/backlog — so every project gets unique, shareable links.
export type AppSection = 'board' | 'backlog' | 'people' | 'ops'

export function projectPath(projectKey: string, section: AppSection): string {
  return `/projects/${encodeURIComponent(projectKey)}/${section}`
}

export function sectionFromPathname(pathname: string): AppSection {
  if (pathname.includes('/backlog')) return 'backlog'
  if (pathname.includes('/people')) return 'people'
  if (pathname.includes('/ops')) return 'ops'
  return 'board'
}

/** The KEY of the currently active project, or undefined when none is loaded. */
export function useCurrentProjectKey(): string | undefined {
  return useStore((state) => state.projects.find((p) => p.id === state.activeProjectId)?.key)
}
