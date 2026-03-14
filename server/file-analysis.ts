import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pdf-parse is CJS-only — use createRequire for ESM compatibility
const _require = createRequire(import.meta.url);
const pdfParse = _require('pdf-parse');
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// After esbuild bundling, __dirname is /app/dist. Try multiple candidate paths.
const tessdataCandidates = [
  path.resolve(__dirname, 'tessdata'),
  path.resolve(__dirname, '..', 'server', 'tessdata'),
  path.resolve(__dirname, '..', 'tessdata'),
  path.resolve(process.cwd(), 'server', 'tessdata'),
];
const tessdataDir = tessdataCandidates.find(dir => {
  try { return fs.existsSync(dir); } catch { return false; }
}) ?? tessdataCandidates[0];

let createWorkerFactory = createWorker;

export const setCreateWorkerFactory = (factory: typeof createWorker) => {
  createWorkerFactory = factory;
};

export const resetCreateWorkerFactory = () => {
  createWorkerFactory = createWorker;
};

export interface FileAnalysisResult {
  content: string;
  metadata: {
    pageCount?: number;
    wordCount?: number;
    fileType: string;
    originalName: string;
    size: number;
  };
  summary?: string;
}

export class FileAnalysisService {
  private static instance: FileAnalysisService;
  private ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

  static getInstance(): FileAnalysisService {
    if (!FileAnalysisService.instance) {
      FileAnalysisService.instance = new FileAnalysisService();
    }
    return FileAnalysisService.instance;
  }

  private async initOCRWorker() {
    if (!this.ocrWorker) {
      this.ocrWorker = await createWorkerFactory('eng', 1, { langPath: tessdataDir });
    }
    return this.ocrWorker;
  }

  async analyzeFile(buffer: Buffer, fileName: string, mimeType: string): Promise<FileAnalysisResult> {
    try {
      const fileType = await fileTypeFromBuffer(buffer);
      const detectedMime = fileType?.mime || mimeType;

      let content = '';
      let metadata: FileAnalysisResult['metadata'] = {
        fileType: detectedMime,
        originalName: fileName,
        size: buffer.length
      };

      switch (detectedMime) {
        case 'application/pdf': {
          const pdfResult = await this.extractFromPDF(buffer);
          content = pdfResult.content;
          metadata.pageCount = pdfResult.pageCount;
          break;
        }

        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          content = await this.extractFromWord(buffer);
          break;

        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/vnd.ms-excel':
          content = await this.extractFromExcel(buffer);
          break;

        case 'image/jpeg':
        case 'image/png':
        case 'image/gif':
        case 'image/webp':
        case 'image/bmp':
          content = await this.extractFromImage(buffer);
          break;

        case 'text/plain':
          content = buffer.toString('utf-8');
          break;

        default:
          // Try to extract as text for unknown formats
          try {
            content = buffer.toString('utf-8');
            // Validate if it's readable text
            if (content.includes('\0') || content.match(/[\x00-\x08\x0E-\x1F\x7F]/)) {
              throw new Error('Binary file detected');
            }
          } catch {
            throw new Error(`Unsupported file type: ${detectedMime}`);
          }
      }

      // Calculate word count
      metadata.wordCount = content.split(/\s+/).filter(word => word.length > 0).length;

      return {
        content: content.trim(),
        metadata,
        summary: this.generateSummary(content, detectedMime)
      };
    } catch (error) {
      throw new Error(`Failed to analyze file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromPDF(buffer: Buffer): Promise<{ content: string; pageCount: number }> {
    try {
      const data = await pdfParse(buffer);
      return {
        content: data.text,
        pageCount: data.numpages,
      };
    } catch (error) {
      throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromWord(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      throw new Error(`Word document extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromExcel(buffer: Buffer): Promise<string> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let content = '';
      
      workbook.SheetNames.forEach((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_txt(worksheet);
        content += `\n--- Sheet ${index + 1}: ${sheetName} ---\n${sheetData}\n`;
      });

      return content.trim();
    } catch (error) {
      throw new Error(`Excel extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractFromImage(buffer: Buffer): Promise<string> {
    try {
      // Validate image metadata first (fast, unlikely to crash)
      let metadata: sharp.Metadata;
      try {
        metadata = await sharp(buffer).metadata();
      } catch {
        return '(Image uploaded — unable to read image metadata)';
      }

      if (!metadata.width || !metadata.height) {
        return '(Image uploaded — unable to process image dimensions)';
      }

      // Skip OCR for very large images to avoid memory exhaustion
      const pixelCount = metadata.width * metadata.height;
      if (pixelCount > 25_000_000) {
        return `(Image uploaded — ${metadata.width}x${metadata.height} ${metadata.format || 'image'}, too large for OCR)`;
      }

      // Convert image to a format suitable for OCR
      const processedImage = await sharp(buffer)
        .greyscale()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      const worker = await this.initOCRWorker();

      // Race OCR against a 30-second timeout
      const ocrPromise = worker.recognize(processedImage);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timed out')), 30000),
      );

      const { data: { text } } = await Promise.race([ocrPromise, timeoutPromise]);

      return text || '(No text detected in image)';
    } catch (error) {
      console.warn('Image OCR failed, returning empty content:', error);
      return '(Image uploaded — text extraction was not possible)';
    }
  }

  private generateSummary(content: string, fileType: string): string {
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;
    
    let typeDescription = 'document';
    if (fileType.includes('pdf')) typeDescription = 'PDF document';
    else if (fileType.includes('word') || fileType.includes('document')) typeDescription = 'Word document';
    else if (fileType.includes('sheet') || fileType.includes('excel')) typeDescription = 'Excel spreadsheet';
    else if (fileType.includes('image')) typeDescription = 'image with extracted text';
    else if (fileType.includes('text')) typeDescription = 'text file';

    return `This ${typeDescription} contains ${wordCount} words and ${charCount} characters of content.`;
  }

  async cleanup() {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
    }
  }
}

export const fileAnalysisService = FileAnalysisService.getInstance();