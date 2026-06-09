import { z } from 'zod'
import { isSupportedFileType, validateFileSize } from './file-utils'

export const DocumentTypeSchema = z.enum([
  'judgment',
  'court_order',
  'contract',
  'agreement',
  'police_report',
  'incident_report',
  'witness_statement',
  'affidavit',
  'pleading',
  'motion',
  'brief',
  'transcript',
  'administrative_decision',
  'regulatory_filing',
  'other'
])

export const UploadDocumentSchema = z.object({
  filename: z.string().min(1),
  fileType: z.string().refine((type) => {
    const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp']
    return supportedTypes.includes(type.toLowerCase())
  }, 'Unsupported file type'),
  fileSize: z.number().refine(validateFileSize, 'File size too large'),
  documentType: DocumentTypeSchema,
})

export const ProcessingOptionsSchema = z.object({
  extractFullContent: z.boolean().default(true),
  customModelId: z.string().optional(),
})

export type DocumentType = z.infer<typeof DocumentTypeSchema>
export type UploadDocument = z.infer<typeof UploadDocumentSchema>
export type ValidatedProcessingOptions = z.infer<typeof ProcessingOptionsSchema>

export function validateDocumentUpload(data: unknown): UploadDocument {
  return UploadDocumentSchema.parse(data)
}

export function validateProcessingOptions(data: unknown): ValidatedProcessingOptions {
  return ProcessingOptionsSchema.parse(data)
}