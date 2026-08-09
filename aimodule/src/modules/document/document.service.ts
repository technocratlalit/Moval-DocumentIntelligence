import fs from 'fs';
import { fetchFileFromUrl } from '../../utils/file-fetcher.util';
import { DLExtractor } from './extractor/dl.extractor';
import { WorkshopBillExtractor } from './extractor/workshop-bill.extractor';
import { RCExtractor } from './extractor/rc.extractor';
import { InsurancePolicyExtractor } from './extractor/insurencepolicy.extractor';
import { ClaimFormExtractor } from './extractor/claim-form.extractor';
import { DocumentPrescreenService } from './prescreen/document.prescreen.service.js';
import { AIService } from '../../infrastructure/ai/ai.service';
import { ObserverService } from '../../infrastructure/observabllity/observer.service.js';

const docType = {
  DL: 'DL',
  RC: 'RC',
  POLICY: 'POLICY',
  CLAIM: 'CLAIM',
  WORKSHOP: 'WORKSHOP',
};

export class DocumentService {
  private dlExtractor: DLExtractor;
  private workshopExtractor: WorkshopBillExtractor;
  private rcExtractor: RCExtractor;
  private policyExtractor: InsurancePolicyExtractor;
  private claimExtractor: ClaimFormExtractor;
  private prescreenService: DocumentPrescreenService;

  constructor() {
    this.dlExtractor = new DLExtractor();
    this.workshopExtractor = new WorkshopBillExtractor();
    this.rcExtractor = new RCExtractor();
    this.policyExtractor = new InsurancePolicyExtractor();
    this.claimExtractor = new ClaimFormExtractor();
    this.prescreenService = new DocumentPrescreenService();
  }

  public async extractData(documentType: string, urlOrUrls: string | string[]) {
    const urls = Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls];
    const typeUpper = documentType.toUpperCase();

    // WORKSHOP → LlamaParse (no Gemini fetch / prescreen)
    if (typeUpper === docType.WORKSHOP) {
      return await this.workshopExtractor.extract(urls);
    }

    const filesData = await Promise.all(urls.map((url) => fetchFileFromUrl(url)));
    const inputData = filesData.length === 1 ? filesData[0] : filesData;

    await this.prescreenService.check(inputData, documentType);

    try {
      switch (typeUpper) {
        case docType.DL:
          return await this.dlExtractor.extract(inputData);
        case docType.RC:
          return await this.rcExtractor.extract(inputData);
        case docType.POLICY:
          return await this.policyExtractor.extract(inputData);
        case docType.CLAIM:
          return await this.claimExtractor.extract(inputData);
        default:
          throw new Error(`Unsupported document type: ${documentType}`);
      }
    } finally {
      const aiService = AIService.getInstance();
      for (const fd of filesData) {
        if (fd?.fileData?.fileUri) {
          ObserverService.getInstance().info(`Cleaning up Gemini uploaded file: ${fd.fileData.fileUri}`);
          aiService.deleteFile(fd.fileData.fileUri).catch((err: any) => {
            ObserverService.getInstance().logError(`Failed to clean up Gemini file`, err);
          });
        }
        if (fd?.localPdfPath) {
          fs.promises.unlink(fd.localPdfPath).catch((err: any) => {
            ObserverService.getInstance().logError('Failed to delete local PDF temp file', err);
          });
        }
        if (fd?.localFilePath && fd.localFilePath !== fd.localPdfPath) {
          fs.promises.unlink(fd.localFilePath).catch((err: any) => {
            ObserverService.getInstance().logError('Failed to delete local file temp path', err);
          });
        }
      }
    }
  }
}
