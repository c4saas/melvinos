import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import type { VoicePlaybackStatus } from './useVoicePlaybackController';

const SILENCE_THRESHOLD = 0.01;     // RMS below this = silence
const SILENCE_DURATION_MS = 1200;   // Silence duration before stopping
const MIN_RECORDING_MS = 500;       // Min recording before silence can trigger stop

export type ListenState = 'idle' | 'listening' | 'processing';

interface UseConversationModeOptions {
  onTranscript: (text: string) => void;
  isAgentResponding: boolean;
  playbackStatus: VoicePlaybackStatus;
  playbackHasAudio: boolean;
  voiceEnabled: boolean;
  stopPlayback?: () => Promise<void>;
}

export interface ConversationModeController {
  isConversationMode: boolean;
  listenState: ListenState;
  startConversation: () => Promise<void>;
  endConversation: () => void;
  interrupt: () => void;
}

export function useConversationMode({
  onTranscript,
  isAgentResponding,
  playbackStatus,
  playbackHasAudio,
  voiceEnabled,
  stopPlayback,
}: UseConversationModeOptions): ConversationModeController {
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [listenState, setListenState] = useState<ListenState>('idle');

  // Mic / recording refs
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);

  // Stable refs for values used inside closures
  const isConversationModeRef = useRef(false);
  const listenStateRef = useRef<ListenState>('idle');
  const playbackStatusRef = useRef<VoicePlaybackStatus>(playbackStatus);
  const stopPlaybackRef = useRef(stopPlayback);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => { isConversationModeRef.current = isConversationMode; }, [isConversationMode]);
  useEffect(() => { listenStateRef.current = listenState; }, [listenState]);
  useEffect(() => { playbackStatusRef.current = playbackStatus; }, [playbackStatus]);
  useEffect(() => { stopPlaybackRef.current = stopPlayback; }, [stopPlayback]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const releaseMic = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
    } catch { /* ignore */ }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    audioChunksRef.current = [];
    silenceStartRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    if (!isConversationModeRef.current) return;
    if (listenStateRef.current === 'listening') return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isConversationModeRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      audioChunksRef.current = [];
      silenceStartRef.current = null;
      recordingStartRef.current = Date.now();

      // VAD setup — separate AudioContext from playback
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Recording setup
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Release the input AudioContext
        audioContextRef.current?.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;

        if (!isConversationModeRef.current) return;

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        // Too short to be real speech
        if (blob.size < 500) {
          setListenState('idle');
          return;
        }

        setListenState('processing');

        try {
          const base64: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const r = reader.result as string;
              resolve(r.split(',')[1] ?? '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const resp = await apiRequest('POST', '/api/transcribe', { audio: base64, format: 'webm' });

          if (!resp.ok) throw new Error('Transcription failed');

          const { text } = await resp.json() as { text: string };
          const transcript = typeof text === 'string' ? text.trim() : '';

          // Filter Whisper hallucinations (single char or very short garbage)
          const wordCount = transcript.split(/\s+/).filter(Boolean).length;
          if (transcript && wordCount >= 1 && transcript.length >= 3) {
            if (isConversationModeRef.current) {
              onTranscriptRef.current(transcript);
              // Leave listenState as 'processing' — transitions to 'idle' via effect
              // when agent finishes and audio is done
            }
          } else {
            // Noise — go idle, auto-restart will pick it up
            setListenState('idle');
          }
        } catch (err) {
          console.error('[conversation-mode] Transcription error:', err);
          setListenState('idle');
        }
      };

      recorder.start(250);
      setListenState('listening');

      // VAD loop
      const data = new Uint8Array(analyser.frequencyBinCount);
      const checkSilence = () => {
        if (!isConversationModeRef.current) return;
        if (listenStateRef.current !== 'listening') return;
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const n = (data[i] - 128) / 128;
          sum += n * n;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();
        const elapsed = now - recordingStartRef.current;

        if (rms < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === null) silenceStartRef.current = now;
          else if (elapsed >= MIN_RECORDING_MS && now - silenceStartRef.current >= SILENCE_DURATION_MS) {
            // Stop — silence detected
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            return;
          }
        } else {
          silenceStartRef.current = null;
          // Interrupt: user speaks while the agent's audio is playing
          if (playbackStatusRef.current === 'playing') {
            stopPlaybackRef.current?.().catch(() => {});
          }
        }

        rafRef.current = requestAnimationFrame(checkSilence);
      };
      rafRef.current = requestAnimationFrame(checkSilence);

    } catch (err) {
      console.error('[conversation-mode] getUserMedia failed:', err);
      setListenState('idle');
    }
  }, []);

  // Auto-restart: when agent done + audio done → start listening again
  // Also handles 'processing' → 'idle' transition when the full cycle completes
  useEffect(() => {
    if (!isConversationMode) return;
    if (isAgentResponding) return;
    if (playbackStatus !== 'idle') return;
    if (playbackHasAudio) return;

    if (listenState === 'processing') {
      // Cycle complete — reset to idle (next render will start listening)
      setListenState('idle');
      return;
    }

    if (listenState === 'idle') {
      void startListening();
    }
  }, [isConversationMode, isAgentResponding, playbackStatus, playbackHasAudio, listenState, startListening]);

  const startConversation = useCallback(async () => {
    if (!voiceEnabled) return;
    setIsConversationMode(true);
    setListenState('idle');
    // auto-restart effect will call startListening on next render
  }, [voiceEnabled]);

  const endConversation = useCallback(() => {
    setIsConversationMode(false);
    setListenState('idle');
    releaseMic();
  }, [releaseMic]);

  const interrupt = useCallback(() => {
    stopPlaybackRef.current?.().catch(() => {});
    // VAD loop will handle continuing to record if mic is open
  }, []);

  // Cleanup on unmount or chat switch
  useEffect(() => {
    return () => {
      releaseMic();
    };
  }, [releaseMic]);

  return { isConversationMode, listenState, startConversation, endConversation, interrupt };
}
