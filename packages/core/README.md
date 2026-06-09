# @workspace/core

Shared OCR service for legal document processing using Azure Document Intelligence.

## Features

- **OCR Processing**: Extract text and structured data from legal documents
- **Document Types**: Supports judgments, contracts, police reports, witness statements, pleadings, and more
- **Background Processing**: Asynchronous document processing with BullMQ and Redis
- **Data Persistence**: PostgreSQL storage with Drizzle ORM
- **Confidence Management**: Configurable confidence thresholds per document type
- **Extensible**: Ready for custom Azure models and future enhancements

## Setup

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://legal_user:legal_pass@localhost:5432/legal_docs

# Redis
REDIS_URL=redis://localhost:6379

# Azure Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-api-key

# Confidence Thresholds (optional)
CONFIDENCE_THRESHOLD_DEFAULT=0.7
CONFIDENCE_THRESHOLD_JUDGMENT=0.8
CONFIDENCE_THRESHOLD_CONTRACT=0.75
```

### Infrastructure

Start PostgreSQL and Redis:

```bash
docker-compose -f docker-compose.infrastructure.yml up -d
```

### Database Setup

Generate and run migrations:

```bash
cd packages/core
bun run db:generate
bun run db:push
```

## Usage

### Basic OCR Processing

```typescript
import { OCRService } from '@workspace/core'

const ocrService = new OCRService()

// Synchronous processing (for small files)
const result = await ocrService.processDocument(
  fileBuffer,
  {
    filename: 'judgment.pdf',
    fileType: 'pdf',
    fileSize: 1024000,
    documentType: 'judgment'
  },
  {
    extractFullContent: true
  }
)

console.log('Case Number:', result.result?.structured.caseNumber)
console.log('Full Text:', result.result?.fullContent.text)
```

### Asynchronous Processing (Recommended)

```typescript
const ocrService = new OCRService({ useQueue: true })

// Returns immediately with document ID
const { documentId } = await ocrService.processDocument(
  fileBuffer,
  {
    filename: 'contract.pdf',
    fileType: 'pdf',
    fileSize: 2048000,
    documentType: 'contract'
  }
)

// Check status later
const document = await ocrService.getDocument(documentId)
console.log('Status:', document?.status)
```

### Query Processed Documents

```typescript
// Get by ID
const doc = await ocrService.getDocument(123)

// Get by case number
const cases = await ocrService.getDocumentByCaseNumber('CV-2023-00123')

// Get by document type
const judgments = await ocrService.getDocumentsByType('judgment')

// Get processing status
const pending = await ocrService.getPendingDocuments()
const completed = await ocrService.getCompletedDocuments()
```

## Supported Document Types

- `judgment` - Court judgments and orders
- `court_order` - Court orders and decrees
- `contract` - Contracts and agreements
- `agreement` - Various agreements
- `police_report` - Police reports and incident reports
- `incident_report` - Incident reports
- `witness_statement` - Witness statements and affidavits
- `affidavit` - Affidavits
- `pleading` - Legal pleadings
- `motion` - Motions and briefs
- `brief` - Appellate briefs
- `transcript` - Court transcripts
- `administrative_decision` - Administrative decisions
- `regulatory_filing` - Regulatory filings
- `other` - Other document types

## API Response Structure

```typescript
interface DocumentExtractionResult {
  structured: {
    caseNumber?: string
    court?: string
    date?: Date
    parties?: Party[]
    judgment?: JudgmentDetails
    amount?: number
  }
  fullContent: {
    text: string
    pages: DocumentPage[]
    tables: Table[]
    keyValuePairs: KeyValuePair[]
    entities: ExtractedEntity[]
  }
  metadata: {
    processingTime: number
    pageCount: number
    fileType: string
    modelUsed: string
  }
  confidence: number
}
```

## Future Enhancements

- **Custom Models**: Support for trained Azure custom models
- **Webhooks**: Real-time notifications for processing completion
- **Knowledge Graph**: Integration with graph database for relationships
- **Advanced Search**: Full-text search and semantic search
- **Batch Processing**: Process multiple documents simultaneously
- **User Permissions**: Access control for document processing

## Development

```bash
# Install dependencies
bun install

# Run type checking
bun run typecheck

# Build package
bun run build

# Run Drizzle Studio
bun run db:studio
```

## Testing

```bash
# Run tests
bun test

# Run with coverage
bun test --coverage
```