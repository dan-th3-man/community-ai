import { PassThrough, Readable } from "stream";
import { IAgentRuntime, ISpeechService, ServiceType } from "@ai16z/eliza";
import { getWavHeader } from "./audioUtils.ts";
import { Service } from "@ai16z/eliza";
import { validateNodeConfig } from "../environment.ts";
import * as Echogarden from "echogarden";
import { elizaLogger } from "@ai16z/eliza";

function prependWavHeader(
    readable: Readable,
    audioLength: number,
    sampleRate: number,
    channelCount: number = 1,
    bitsPerSample: number = 16
): Readable {
    const wavHeader = getWavHeader(
        audioLength,
        sampleRate,
        channelCount,
        bitsPerSample
    );
    let pushedHeader = false;
    const passThrough = new PassThrough();
    readable.on("data", function (data) {
        if (!pushedHeader) {
            passThrough.push(wavHeader);
            pushedHeader = true;
        }
        passThrough.push(data);
    });
    readable.on("end", function () {
        passThrough.end();
    });
    return passThrough;
}

async function getVoiceSettings(runtime: IAgentRuntime) {
    const hasElevenLabs = !!runtime.getSetting("ELEVENLABS_XI_API_KEY");
    const useVits = !hasElevenLabs;

    // Add debug logging
    elizaLogger.debug("ElevenLabs API Key:", !!runtime.getSetting("ELEVENLABS_XI_API_KEY"));
    elizaLogger.debug("Voice settings:", {
        hasElevenLabs,
        useVits,
        voiceSettings: runtime.character.settings?.voice,
        elevenlabsSettings: runtime.character.settings?.voice?.elevenlabs,
    });

    return {
        elevenlabsVoiceId:
            runtime.character.settings?.voice?.elevenlabs?.voiceId ||
            runtime.getSetting("ELEVENLABS_VOICE_ID"),
        elevenlabsModel:
            runtime.character.settings?.voice?.elevenlabs?.model ||
            runtime.getSetting("ELEVENLABS_MODEL_ID") ||
            "eleven_monolingual_v1",
        elevenlabsStability:
            runtime.character.settings?.voice?.elevenlabs?.stability ||
            runtime.getSetting("ELEVENLABS_VOICE_STABILITY") ||
            "0.5",
        // ... other ElevenLabs settings ...
        vitsVoice:
            runtime.character.settings?.voice?.model ||
            runtime.character.settings?.voice?.url ||
            runtime.getSetting("VITS_VOICE") ||
            "en_US-hfc_female-medium",
        useVits,
    };
}

async function textToSpeech(runtime: IAgentRuntime, text: string) {
    await validateNodeConfig(runtime);
    const { elevenlabsVoiceId } = await getVoiceSettings(runtime);

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${elevenlabsVoiceId}/stream?optimize_streaming_latency=${runtime.getSetting("ELEVENLABS_OPTIMIZE_STREAMING_LATENCY")}&output_format=${runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT")}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "xi-api-key": runtime.getSetting("ELEVENLABS_XI_API_KEY"),
                },
                body: JSON.stringify({
                    model_id: runtime.getSetting("ELEVENLABS_MODEL_ID"),
                    text: text,
                    voice_settings: {
                        similarity_boost: runtime.getSetting("ELEVENLABS_VOICE_SIMILARITY_BOOST"),
                        stability: runtime.getSetting("ELEVENLABS_VOICE_STABILITY"),
                        style: runtime.getSetting("ELEVENLABS_VOICE_STYLE"),
                        use_speaker_boost: runtime.getSetting("ELEVENLABS_VOICE_USE_SPEAKER_BOOST"),
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorBodyString = await response.text();
            throw new Error(`Received status ${response.status} from Eleven Labs API: ${errorBodyString}`);
        }

        // Create a readable stream from the response body
        const readable = new Readable();
        const buffer = await response.arrayBuffer();
        readable.push(Buffer.from(buffer));
        readable.push(null);

        if (runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT").startsWith("pcm_")) {
            const sampleRate = parseInt(runtime.getSetting("ELEVENLABS_OUTPUT_FORMAT").substring(4));
            return prependWavHeader(readable, buffer.byteLength, sampleRate, 1, 16);
        }

        return readable;
    } catch (error) {
        elizaLogger.error("ElevenLabs API error:", error);
        throw error;
    }
}

async function processVitsAudio(audio: any): Promise<Readable> {
    let wavStream: Readable;
    if (audio instanceof Buffer) {
        console.log("audio is a buffer");
        wavStream = Readable.from(audio);
    } else if ("audioChannels" in audio && "sampleRate" in audio) {
        console.log("audio is a RawAudio");
        const floatBuffer = Buffer.from(audio.audioChannels[0].buffer);
        console.log("buffer length: ", floatBuffer.length);

        const sampleRate = audio.sampleRate;
        const floatArray = new Float32Array(floatBuffer.buffer);
        const pcmBuffer = new Int16Array(floatArray.length);

        for (let i = 0; i < floatArray.length; i++) {
            pcmBuffer[i] = Math.round(floatArray[i] * 32767);
        }

        const wavHeaderBuffer = getWavHeader(
            pcmBuffer.length * 2,
            sampleRate,
            1,
            16
        );
        const wavBuffer = Buffer.concat([
            wavHeaderBuffer,
            Buffer.from(pcmBuffer.buffer),
        ]);
        wavStream = Readable.from(wavBuffer);
    } else {
        throw new Error("Unsupported audio format");
    }
    return wavStream;
}

async function generateVitsAudio(
    runtime: IAgentRuntime,
    text: string
): Promise<Readable> {
    const { vitsVoice } = await getVoiceSettings(runtime);
    const { audio } = await Echogarden.synthesize(text, {
        engine: "vits",
        voice: vitsVoice,
    });
    return processVitsAudio(audio);
}

export class SpeechService extends Service implements ISpeechService {
    static serviceType: ServiceType = ServiceType.SPEECH_GENERATION;

    async initialize(_runtime: IAgentRuntime): Promise<void> {}

    getInstance(): ISpeechService {
        return SpeechService.getInstance();
    }

    async generate(runtime: IAgentRuntime, text: string): Promise<Readable> {
        try {
            const { useVits } = await getVoiceSettings(runtime);

            // Add debug logging
            elizaLogger.debug("Generate speech settings:", {
                useVits,
                hasElevenLabsKey: !!runtime.getSetting("ELEVENLABS_XI_API_KEY"),
                text: text.substring(0, 50) + "..." // Log first 50 chars of text
            });

            if (useVits || !runtime.getSetting("ELEVENLABS_XI_API_KEY")) {
                elizaLogger.debug("Using VITS because:", {
                    useVits,
                    noElevenLabsKey: !runtime.getSetting("ELEVENLABS_XI_API_KEY")
                });
                return await generateVitsAudio(runtime, text);
            }

            return await textToSpeech(runtime, text);
        } catch (error) {
            console.error("Speech generation error:", error);
            elizaLogger.error("Falling back to VITS due to error:", error);
            return await generateVitsAudio(runtime, text);
        }
    }
}
