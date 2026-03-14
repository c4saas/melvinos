import { z } from 'zod';
import {
  voiceAudioClipSchema,
  type OutputTemplate,
  type OutputTemplateValidation,
} from '@shared/schema';

export const audioClipMetadataSchema = voiceAudioClipSchema.extend({
  text: z.string().optional(),
});

export type VoiceClipMetadata = z.infer<typeof audioClipMetadataSchema>;

export const chatMetadataSchema = z.object({
  thorMode: z.boolean().optional(),
  thinkingLevel: z.enum(['off', 'standard', 'extended']).optional(),
  voiceMode: z.boolean().optional(),
  outputTemplateId: z.string().uuid('Output template id must be a valid UUID').optional(),
  audioClips: z.array(audioClipMetadataSchema).optional(),
  preferredModelId: z.string().optional(),
  /** Session-level Claude Code model override */
  ccModel: z.string().optional(),
  /** Session-level Claude Code effort level */
  ccEffort: z.enum(['low', 'medium', 'high']).optional(),
});

export function buildAssistantMetadata(options: {
  baseMetadata?: z.infer<typeof chatMetadataSchema>;
  outputTemplate?: OutputTemplate | null;
  executedTools?: string[];
  thinkingContent?: string;
  validation?: OutputTemplateValidation | null;
  voiceClips?: VoiceClipMetadata[];
  voiceMode?: boolean;
}): Record<string, unknown> | undefined {
  const {
    baseMetadata,
    outputTemplate,
    executedTools,
    thinkingContent,
    validation,
    voiceClips,
    voiceMode,
  } = options;

  const metadata: Record<string, unknown> = {};

  const baseClips = baseMetadata?.audioClips ?? [];
  const incomingClips = voiceClips ?? [];
  const combinedClips = [...baseClips, ...incomingClips];
  const hasVoiceClips = combinedClips.length > 0;
  const requestedVoiceMode = voiceMode ?? baseMetadata?.voiceMode ?? null;

  if (baseMetadata?.thorMode) {
    metadata.thorMode = true;
  }

  if (baseMetadata?.thinkingLevel && baseMetadata.thinkingLevel !== 'off') {
    metadata.thinkingLevel = baseMetadata.thinkingLevel;
  }

  if (outputTemplate) {
    metadata.outputTemplateId = outputTemplate.id;
    metadata.outputTemplateName = outputTemplate.name;
    metadata.outputTemplateCategory = outputTemplate.category;
    metadata.outputTemplateFormat = outputTemplate.format;
  } else if (baseMetadata?.outputTemplateId) {
    metadata.outputTemplateId = baseMetadata.outputTemplateId;
  }

  if (executedTools && executedTools.length > 0) {
    metadata.executedTools = executedTools;
  }

  if (thinkingContent) {
    metadata.thinkingContent = thinkingContent;
  }

  if (validation) {
    metadata.outputTemplateValidation = validation;
  }

  if (hasVoiceClips) {
    metadata.voiceMode = true;
    metadata.audioClips = combinedClips.map(clip => ({
      clipId: clip.clipId,
      mimeType: clip.mimeType,
      durationMs: clip.durationMs,
      sizeBytes: clip.sizeBytes,
      audioUrl: clip.audioUrl,
      text: clip.text,
    }));
  } else if (requestedVoiceMode === true) {
    // Voice playback was requested but there are no clips yet. To keep the
    // metadata aligned with actual audio availability we intentionally avoid
    // setting voiceMode until clips exist.
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
