import { Router } from "express";
import { DocumentController } from "./document.controller";
import { validateExtractDocument } from "./validator/document.validator";
import { authMiddleware, ROLES } from "../../shared/middleware/auth.middleware";


const router = Router();
const documentController = new DocumentController();

router.post(
  "/extract",
  authMiddleware([ROLES.SURVEYOR, ROLES.REVIEWER, ROLES.ADMIN]),
  validateExtractDocument,
  documentController.extractDocument
);

router.get(
  "/jobs/:jobId",
  authMiddleware([ROLES.SURVEYOR, ROLES.REVIEWER, ROLES.ADMIN]),
  documentController.getJobStatus
);

export default router;