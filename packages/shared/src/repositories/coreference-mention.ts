import { BaseRepository } from './base'
import {
	coreferenceMentions,
	type CoreferenceMention,
	type NewCoreferenceMention,
} from '../schemas'

export class CoreferenceMentionRepository extends BaseRepository<CoreferenceMention, NewCoreferenceMention> {
	constructor() {
		super(coreferenceMentions)
	}
}

export const coreferenceMentionRepository = new CoreferenceMentionRepository()
