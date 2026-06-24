import { Elysia } from 'elysia'
import { health } from './health'
import { admin } from './admin'
import { upload } from './upload'
import { internal } from './internal'

export const modules = new Elysia()
	.use(health)
	.use(admin)
	.use(upload)
	.use(internal)
