-- Enable pgvector extension for vector embeddings
-- Required by: document_chunks.embedding (vector(3072))
-- Run this BEFORE drizzle-kit migrate
CREATE EXTENSION IF NOT EXISTS vector;
