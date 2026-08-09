import { Upload } from '../../model/upload.schema.js';
import { ApiError } from '../../shared/apiError.js';
import { createPresignedUploadUrl, deleteR2Object } from './r2.storage.js';

const VALID_PURPOSES = ['rc', 'dl', 'policy', 'claim', 'workshop', 'other'];

export class UploadService {
  async requestUploadUrl(filename, contentType, purpose = 'other') {
    if (!filename || !contentType) {
      throw ApiError.badRequest('filename and contentType are required.');
    }
    const normalizedPurpose = VALID_PURPOSES.includes(purpose) ? purpose : 'other';
    return createPresignedUploadUrl(filename, contentType, normalizedPurpose);
  }

  async saveFileRecord(body) {
    const { url, publicId, originalName, mimeType, size, purpose } = body;
    if (!url || !publicId || !originalName) {
      throw ApiError.badRequest('url, publicId, and originalName are required.');
    }
    const normalizedPurpose = VALID_PURPOSES.includes(purpose) ? purpose : 'other';
    return Upload.create({
      url,
      publicId,
      originalName,
      mimeType,
      size,
      purpose: normalizedPurpose,
    });
  }

  async listFiles(purpose) {
    const filter = purpose && VALID_PURPOSES.includes(purpose) ? { purpose } : {};
    return Upload.find(filter).sort({ createdAt: -1 }).limit(100);
  }

  async deleteFile(id) {
    const upload = await Upload.findById(id);
    if (!upload) return false;
    try {
      await deleteR2Object(upload.publicId);
    } catch (err) {
      console.warn('[upload] R2 delete failed:', err.message);
    }
    await upload.deleteOne();
    return true;
  }
}
