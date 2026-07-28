import { asyncHandler } from '../../shared/asyncHandler.js';
import { ApiError } from '../../shared/apiError.js';
import { ApiResponse } from '../../shared/apiResponse.js';
import { ExtractionService } from './extraction.service.js';

const extractionService = new ExtractionService();

export class ExtractionController {
  createExtraction = asyncHandler(async (req, res) => {
    const { documentType, uploadIds, urls, mode, priority, correlationId, tableLayout } = req.body;
    const job = await extractionService.createExtraction({
      documentType,
      uploadIds,
      urls,
      mode,
      priority,
      correlationId,
      tableLayout,
    });
    res.status(201).json(new ApiResponse(201, job, 'Extraction started.'));
  });

  listExtractions = asyncHandler(async (req, res) => {
    const type = req.query.type;
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const result = await extractionService.listExtractions({ documentType: type, page, limit });
    res.status(200).json(new ApiResponse(200, result, 'Extractions fetched successfully.'));
  });

  getExtraction = asyncHandler(async (req, res) => {
    const job = await extractionService.getExtraction(req.params.id);
    res.status(200).json(new ApiResponse(200, job, 'Extraction fetched successfully.'));
  });

  deleteExtraction = asyncHandler(async (req, res) => {
    const success = await extractionService.deleteExtraction(req.params.id);
    if (!success) throw ApiError.notFound('Extraction job not found.');
    res.status(200).json(new ApiResponse(200, null, 'Extraction deleted successfully.'));
  });

  getReview = asyncHandler(async (req, res) => {
    const data = await extractionService.getReview(req.params.id);
    res.status(200).json(new ApiResponse(200, data, 'Review data fetched.'));
  });

  submitReview = asyncHandler(async (req, res) => {
    const job = await extractionService.submitReview(req.params.id, req.body?.corrections ?? []);
    res.status(200).json(new ApiResponse(200, job, 'Review corrections applied.'));
  });
}
