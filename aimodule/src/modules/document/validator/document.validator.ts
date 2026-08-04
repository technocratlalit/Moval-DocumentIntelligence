import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const ExtractDocumentSchema = z.object({
  body: z.object({
    type: z.enum(['DL', 'RC', 'POLICY', 'CLAIM', 'WORKSHOP']),
    urls: z.union([
      z.string().url('Must be a valid URL'),
      z.array(z.string().url('Must be a valid URL')).min(1, 'Array must contain at least one URL'),
    ]),
    /** sync = wait for result (default). async = 202 + webhook only */
    mode: z.enum(['sync', 'async']).optional(),
    /** urgent | normal | low — maps to QUEUE_PRIORITY_* in .env */
    priority: z.enum(['urgent', 'normal', 'low']).optional(),
    /** WORKSHOP only: deprecated — ignored; output is always dynamic parts/labour/lineItems */
    tableLayout: z.enum(['split', 'sequential']).optional(),
  }),
});

export const validateExtractDocument = (req: Request, res: Response, next: NextFunction): void => {
  try {
    ExtractDocumentSchema.parse({ body: req.body });
    next();
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: error.errors || error.message,
    });
  }
};
