/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';
import type { LineageRuntimeInfo } from '../shared/runtimeInfoTypes';

export type LineageCliIdentity = NonNullable<LineageRuntimeInfo['cli']>;

const LineageCliContext = createContext<LineageCliIdentity | null>(null);

export function LineageCliProvider({ children, runtime }: { children: ReactNode; runtime: LineageRuntimeInfo | null }) {
  return <LineageCliContext.Provider value={runtime?.cli || null}>{children}</LineageCliContext.Provider>;
}

export function useLineageCli(): LineageCliIdentity | null {
  return useContext(LineageCliContext);
}

export function lineageCliCommand(cli: LineageCliIdentity | null, command: string): string {
  if (!cli) return 'Lineage runtime identity unavailable; refresh before copying this command.';
  const normalized = command.trim().replace(/\s+--json$/, '');
  return `${cli.launcher} ${normalized} ${cli.runtime_selector} --json`;
}
