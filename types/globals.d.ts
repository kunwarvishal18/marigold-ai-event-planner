// Globals provided by the host page, declared for the type checker (npm run typecheck).

/** A capability returned by the claude.ai Artifact runtime. */
interface ClaudeSampleCapability {
  (
    prompt: string,
    options: { modelTier: string; signal?: AbortSignal; cache: boolean },
  ): Promise<{ text?: string }>;
}

interface ClaudeDownloadsCapability {
  save(file: { filename: string; data: string | Blob }): Promise<void>;
}

interface JsPdfDocument {
  setFont(family: string, style: string): void;
  setFontSize(size: number): void;
  splitTextToSize(text: string, width: number): string[];
  text(text: string, x: number, y: number, options?: { align?: "left" | "right" | "center" }): void;
  addPage(): void;
  output(type: "blob"): Blob;
}

interface JsPdfNamespace {
  jsPDF: new (options: { unit: string; format: string }) => JsPdfDocument;
}

interface Window {
  /** The claude.ai Artifact runtime, present only inside claude.ai. */
  claude?: { use(name: string): Promise<unknown> };
  /** jsPDF, set by the integrity-checked CDN script on first PDF export. */
  jspdf?: JsPdfNamespace;
  /** Read-only hooks for the browser tests. */
  MarigoldTest?: Record<string, unknown>;
}
