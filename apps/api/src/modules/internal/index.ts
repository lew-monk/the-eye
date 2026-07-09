import { Elysia } from 'elysia'
import { coreference } from './coreference'
import { participants } from './participants'
import { chunks } from './chunks'
import { documents } from './documents'

export const internal = new Elysia({ prefix: '/internal/documents' })
	.use(coreference)
	.use(participants)
	.use(chunks)
	.use(documents)
