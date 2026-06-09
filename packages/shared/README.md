## Shared Database & Persistence Layer

The `@workspace/shared` package now contains the centralized database connection and persistence layer that can be accessed by all apps and packages in the workspace.

### Available Exports

```typescript
import { 
  db,                                    // Drizzle database instance
  documents, processingLogs,            // Database schemas
  DocumentRepository,                   // Repository class
  DocumentType,                         // Type definitions
  validateDocumentUpload,               // Validation functions
  getDatabaseConfig,                    // Database configuration
  BullMQClient,                         // Queue client
  getQueueConfig                        // Queue configuration
} from '@workspace/shared'
```

### Usage Examples

#### In API Apps:
```typescript
import { DocumentRepository, validateDocumentUpload } from '@workspace/shared'

const repository = new DocumentRepository()

// Create document
const validatedData = validateDocumentUpload(req.body)
const document = await repository.create(validatedData)

// Query documents
const documents = await repository.findByStatus('completed')
```

#### In Other Packages:
```typescript
import { db, documents } from '@workspace/shared'

// Direct database access
const result = await db.select().from(documents).where(eq(documents.status, 'pending'))
```

### Environment Variables Required

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection URL (for queues)

### Database Schema

The shared package includes:
- `documents` table - Document metadata and processing results
- `processingLogs` table - Processing history and logs
- Full Drizzle ORM setup with type safety

### Migration Support

Database migrations can be run from any package:

```bash
cd packages/core
bun run db:generate    # Generate migrations
bun run db:push        # Push schema changes
bun run db:migrate     # Run migrations
```

This centralized approach ensures consistent data access across all applications in the workspace.