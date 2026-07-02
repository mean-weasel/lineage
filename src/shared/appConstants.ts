export const appName = 'Lineage';
export const appDescription = 'Local-first creative lineage workspace';
export const lineageCliCommand = 'npx lineage';

export function lineageCommand(command: string): string {
  return `${lineageCliCommand} ${command}`;
}
