import { GoogleGenAI, GenerateContentConfig, FinishReason } from '@google/genai';

import { _config } from '../../../config/config';

import { IAIProvider } from '../ai.interface';

import { JsonUtil } from '../../../utils/json.util';

import { RetryUtil } from '../../../utils/retry.util';

import { ObserverService } from '../../../infrastructure/observabllity/observer.service.js';

import { computeCost, logGeminiCall } from '../../../cost/index.js';
import { getPromptCachingMode, PromptCacheService } from '../prompt-cache.service.js';



export class GeminiProvider implements IAIProvider {

    private static instance: GeminiProvider;

    private ai!: GoogleGenAI;

    private model: string;

    private obs = ObserverService.getInstance();



    private constructor() {
        this.ai = new GoogleGenAI({ apiKey: _config.GEMINI_API_KEY as string });
        this.model = _config.AI_MODEL || 'gemini-3.5-flash';
    }



    public static getInstance(): GeminiProvider {

        if (!GeminiProvider.instance) {

            GeminiProvider.instance = new GeminiProvider();

        }

        return GeminiProvider.instance;

    }



    public async uploadFile(filePath: string, mimeType: string, filename: string): Promise<string> {

        try {

            const uploadResult = await this.ai.files.upload({

                file: filePath,

                config: { mimeType }

            });

            this.obs.info(`Gemini API: Successfully uploaded file to Gemini: ${uploadResult.uri || ''}`);

            return uploadResult.uri || '';

        } catch (error) {

            this.obs.logError('Gemini API: Failed to upload file:', error);

            throw error;

        }

    }



    public async deleteFile(fileUri: string): Promise<void> {

        try {

            let name = fileUri;

            if (fileUri.includes('/files/')) {

                name = 'files/' + fileUri.split('/files/').pop();

            }

            this.obs.info(`Gemini API: Deleting file from Gemini: ${name}`);

            await this.ai.files.delete({ name });

            this.obs.info(`Gemini API: Successfully deleted file from Gemini: ${name}`);

        } catch (error) {

            this.obs.logError(`Gemini API: Failed to delete file ${fileUri}:`, error);

        }

    }



    public async generateStructuredContent(

        inputData: any,

        prompt: string,

        schema?: any,

        maxRetries = 3,

        maxOutputTokens?: number,

        modelOverride?: string,

        cacheKey?: string,

        callPhase: 'prescreen' | 'extraction' = 'extraction',

    ): Promise<any> {
        const modelToUse = modelOverride ?? this.model;

        const cacheMode = getPromptCachingMode();



        const genConfig: GenerateContentConfig = {

            responseMimeType: 'application/json',

            temperature: 0.1,

            maxOutputTokens: maxOutputTokens ?? 4096,

        };


        // Lite models: do not send thinkingConfig (2.5-flash-lite 400s; 3.1-lite worked this way in 58eb947).
        if (callPhase === 'extraction' && !modelToUse.toLowerCase().includes('lite')) {
            (genConfig as any).thinkingConfig = { thinkingBudget: 0 };
        }



        if (schema) {

            genConfig.responseSchema = schema;

        }



        // Explicit caching — store static prompt in Gemini cache, send files only per request

        let cachedContentName: string | undefined;

        if (cacheMode === 'explicit' && cacheKey) {

            cachedContentName = await PromptCacheService.resolve(this.ai, modelToUse, cacheKey, prompt);

            if (cachedContentName) {

                genConfig.cachedContent = cachedContentName;

            }

        }



        const parts: any[] = [];



        // Implicit: put large static prompt FIRST (Google recommendation for auto cache hits)

        // Explicit with active cache: prompt lives in cache — do not repeat in parts

        // Off: legacy order — prompt after files

        const promptInParts = !cachedContentName && cacheMode !== 'off';

        if (promptInParts && cacheMode === 'implicit') {

            parts.push({ text: prompt });

        }



        if (inputData) {

            const dataArray = Array.isArray(inputData) ? inputData : [inputData];

            dataArray.forEach((data, index) => {

                if (dataArray.length > 1) {

                    parts.push({ text: `Document Page ${index + 1}:` });

                }

                if (data.fileData) {

                    parts.push({ fileData: data.fileData });

                } else if (data.inlineData) {

                    parts.push({ inlineData: data.inlineData });

                }

            });

        }



        if (!cachedContentName && (cacheMode === 'off' || !promptInParts)) {

            parts.push({ text: prompt });

        }



        const contents = [{ role: 'user', parts }];



        return RetryUtil.execute(async () => {

            const callStart = Date.now();

            let promptTokens = 0;

            let candidatesTokens = 0;

            let cachedTokens = 0;

            let costLogged = false;



            try {

                const response = await this.ai.models.generateContent({

                    model: modelToUse,

                    contents,

                    config: genConfig,

                });



                const latencyMs = Date.now() - callStart;



                if (response.usageMetadata) {

                    promptTokens = response.usageMetadata.promptTokenCount || 0;

                    candidatesTokens = response.usageMetadata.candidatesTokenCount || 0;

                    cachedTokens = response.usageMetadata.cachedContentTokenCount || 0;

                }



                const candidate = response.candidates?.[0];

                if (candidate?.finishReason === FinishReason.MAX_TOKENS) {

                    const usedTokens = candidatesTokens || 'unknown';

                    const configuredMax = genConfig.maxOutputTokens ?? 'default';

                    const truncMsg =

                        `JSON_PARSE_ERROR: RESPONSE_TRUNCATED — Gemini hit the output token limit ` +

                        `(used ${usedTokens} of ${configuredMax} tokens).`;

                    this.obs.logError(

                        `Gemini API: Response truncated (MAX_TOKENS). ` +

                        `Response tokens used: ${usedTokens} / limit: ${configuredMax}. Marking as non-retryable.`

                    );

                    const cost = computeCost(modelToUse, promptTokens, candidatesTokens, cachedTokens);

                    logGeminiCall({
                        model: modelToUse,
                        promptTokens,
                        responseTokens: candidatesTokens,
                        totalTokens: response.usageMetadata?.totalTokenCount ?? promptTokens + candidatesTokens,
                        cachedTokens: cost.cachedTokens,
                        cacheMode,
                        cost,
                        latencyMs,
                        status: 'failure',
                        callPhase,
                        error: truncMsg,
                    });

                    costLogged = true;

                    throw new Error(truncMsg);

                }



                if (response.usageMetadata) {

                    const totalTokens = response.usageMetadata.totalTokenCount || 0;

                    const cost = computeCost(modelToUse, promptTokens, candidatesTokens, cachedTokens);

                    logGeminiCall({
                        model: modelToUse,
                        promptTokens,
                        responseTokens: candidatesTokens,
                        totalTokens,
                        cachedTokens: cost.cachedTokens,
                        cacheMode,
                        cost,
                        latencyMs,
                        status: 'success',
                        callPhase,
                    });

                    costLogged = true;



                    if (cachedTokens > 0) {

                        this.obs.info('Gemini context cache hit', {

                            cacheMode,

                            cachedTokens,

                            savingsUsd: cost.savingsUsd,

                            cacheKey,

                        });

                    }

                }



                if (!response.text) {

                    throw new Error('No text returned from Gemini API');

                }



                return JsonUtil.cleanAndParse(response.text);



            } catch (err: any) {

                const latencyMs = Date.now() - callStart;

                if (!costLogged) {
                    const cost = computeCost(modelToUse, promptTokens, candidatesTokens, cachedTokens);

                    logGeminiCall({
                        model: modelToUse,
                        promptTokens,
                        responseTokens: candidatesTokens,
                        totalTokens: promptTokens + candidatesTokens,
                        cachedTokens: cost.cachedTokens,
                        cacheMode,
                        cost,
                        latencyMs,
                        status: 'failure',
                        callPhase,
                        error: err?.message ?? String(err),
                    });
                }

                throw err;

            }

        }, maxRetries);

    }

}


