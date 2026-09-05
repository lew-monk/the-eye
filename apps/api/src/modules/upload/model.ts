import { t } from 'elysia'

export const UploadModel = {
	body: t.Object({
		file: t.File({
			error() {
				return { message: 'Please select a file to upload' }
			},
			format: 'image/*',
			description: 'File must be a PDF, PNG, JPEG, TIFF, or TIFF file',
		}),
		documentType: t.String({
			error: 'Missing document type',
			description:
				'Document type must be one of the following: judgment, court_order, contract, agreement, police_report, incident_report, witness_statement, affidavit, pleading, motion, brief, transcript, administrative_decision, regulatory_filing, other',
		}),
		caseId: t.Optional(
			t.String({
				description: 'Case ID to associate this document with',
			}),
		),
	}),
	response400: t.Object({
		error: t.String(),
	}),
}
