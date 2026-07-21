// Blockchain types - aligned with database schema

export interface ChartDataPoint {
  name: string;
  value: number;
  timestamp?: number;
}

export interface TerminalCommand {
  input: string;
  output: string;
  timestamp: number;
  type: 'success' | 'error' | 'info' | 'default';
}
