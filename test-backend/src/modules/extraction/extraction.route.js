import { Router } from 'express';
import { ExtractionController } from './extraction.controller.js';

const router = Router();
const extractionController = new ExtractionController();

router.post('/', extractionController.createExtraction);
router.get('/', extractionController.listExtractions);
router
  .route('/:id')
  .get(extractionController.getExtraction)
  .delete(extractionController.deleteExtraction);

router.get('/:id/review', extractionController.getReview);
router.post('/:id/review', extractionController.submitReview);

export default router;
