export interface NormalizedDocument {
  id: string;
  source: 'qdrant' | 'postgres' | 'drive' | 'notion' | 'recall' | 'workspace';
  sourceCollection?: string;
  sourceId: string;
  title: string;
  content: string;
  category?: string;
  metadata: Record<string, unknown>;
}

export interface TopicCluster {
  label: string;
  category: string;
  documents: NormalizedDocument[];
}

export interface ConsolidatedPage {
  title: string;
  category: string;
  content: string;
  sourceCount: number;
  documentIds: string[];
}

export interface PipelineState {
  phase: 'extract' | 'cluster' | 'consolidate' | 'output' | 'done';
  totalDocuments: number;
  clusters: number;
  pagesCreated: number;
  errors: string[];
  notionParentId?: string;
}

export interface PipelineOptions {
  sources?: string[];
  dryRun?: boolean;
  /** Task ID used for checkpoint files — enables resume after crash/restart */
  taskId?: string;
  /**
   * 'full': process all documents regardless of lastConsolidationAt (default on first run).
   * 'incremental': only process documents newer than lastConsolidationAt.
   * Omit to auto-detect: incremental if lastConsolidationAt is set, full otherwise.
   */
  mode?: 'full' | 'incremental';
}
