import mongoose from 'mongoose';

const extractionJobSchema = new mongoose.Schema(
  {
    correlationId: { type: String, required: true, unique: true },
    documentType: { type: String, enum: ['RC', 'DL', 'WORKSHOP', 'POLICY', 'CLAIM'], required: true },
    uploadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Upload' }],
    urls: [{ type: String }],
    mode: { type: String, enum: ['sync', 'async'], default: 'sync' },
    priority: { type: String, enum: ['urgent', 'normal', 'low'], default: 'normal' },
    tableLayout: { type: String, enum: ['split', 'sequential'] },
    status: { type: String, enum: ['queued', 'processing', 'completed', 'failed', 'needs_review'], default: 'queued' },
    jobId: { type: String },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    cached: { type: Boolean, default: false },
    durationMs: { type: Number },
    completedAt: { type: Date },
    totalTokens: { type: Number },
    totalCostINR: { type: Number },
    claimMeta: {
      insurer: String,
      templateVersion: String,
      formLanguage: String,
    },
    pipelineStatus: { type: String },
    rawExtractions: [{ sourceModel: String, rawJson: mongoose.Schema.Types.Mixed, createdAt: Date }],
    fieldConfidence: [{ path: String, confidence: Number, flaggedForReview: Boolean }],
    flaggedFields: [{ path: String, reason: String, confidence: Number }],
    reviewCorrections: [{ path: String, oldValue: mongoose.Schema.Types.Mixed, newValue: mongoose.Schema.Types.Mixed, correctedAt: Date }],
  },
  { timestamps: true },
);

export const ExtractionJob = mongoose.model('ExtractionJob', extractionJobSchema);
