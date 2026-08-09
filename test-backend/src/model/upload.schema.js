import mongoose from 'mongoose';

const uploadSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String },
    size: { type: Number },
    purpose: {
      type: String,
      enum: ['rc', 'dl', 'policy', 'claim', 'workshop', 'other'],
      default: 'other',
    },
  },
  { timestamps: true },
);

export const Upload = mongoose.model('Upload', uploadSchema);
