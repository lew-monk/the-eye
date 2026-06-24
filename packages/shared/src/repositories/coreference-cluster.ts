import { BaseRepository } from './base'
import {
	coreferenceClusters,
	type CoreferenceCluster,
	type NewCoreferenceCluster,
} from '../schemas'

export class CoreferenceClusterRepository extends BaseRepository<CoreferenceCluster, NewCoreferenceCluster> {
	constructor() {
		super(coreferenceClusters)
	}
}

export const coreferenceClusterRepository = new CoreferenceClusterRepository()
