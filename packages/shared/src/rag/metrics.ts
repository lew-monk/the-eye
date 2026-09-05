/**
 * Retrieval metrics for the legal RAG eval suite.
 * Generation/citation metrics belong in a later phase (span overlap, not LLM-as-judge).
 */

export interface RetrievalJudgment {
	queryId: string
	goldChunkIds: string[]
	retrievedChunkIds: string[]
}

export interface RetrievalScores {
	recallAtK: number
	precisionAtK: number
	mrr: number
	ndcgAtK: number
	k: number
}

export function chunkId(documentId: number, chunkIndex: number): string {
	return `${documentId}:${chunkIndex}`
}

export function recallAtK(gold: string[], retrieved: string[], k: number): number {
	if (gold.length === 0) return 1
	const top = new Set(retrieved.slice(0, k))
	const hits = gold.filter((id) => top.has(id)).length
	return hits / gold.length
}

export function precisionAtK(gold: string[], retrieved: string[], k: number): number {
	const top = retrieved.slice(0, k)
	if (top.length === 0) return 0
	const goldSet = new Set(gold)
	const hits = top.filter((id) => goldSet.has(id)).length
	return hits / top.length
}

export function mrr(gold: string[], retrieved: string[]): number {
	const goldSet = new Set(gold)
	for (let i = 0; i < retrieved.length; i++) {
		const id = retrieved[i]
		if (id !== undefined && goldSet.has(id)) return 1 / (i + 1)
	}
	return 0
}

function dcg(relevances: number[]): number {
	return relevances.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0)
}

export function ndcgAtK(gold: string[], retrieved: string[], k: number): number {
	const goldSet = new Set(gold)
	const actual = retrieved.slice(0, k).map((id) => (goldSet.has(id) ? 1 : 0))
	const idealRel = Array.from({ length: Math.min(k, gold.length) }, () => 1)
	const denom = dcg(idealRel)
	if (denom === 0) return 0
	return dcg(actual) / denom
}

export function scoreRetrieval(j: RetrievalJudgment, k: number): RetrievalScores {
	return {
		k,
		recallAtK: recallAtK(j.goldChunkIds, j.retrievedChunkIds, k),
		precisionAtK: precisionAtK(j.goldChunkIds, j.retrievedChunkIds, k),
		mrr: mrr(j.goldChunkIds, j.retrievedChunkIds),
		ndcgAtK: ndcgAtK(j.goldChunkIds, j.retrievedChunkIds, k),
	}
}

export function mean(values: number[]): number {
	if (values.length === 0) return 0
	return values.reduce((a, b) => a + b, 0) / values.length
}

export function aggregateRetrieval(judgments: RetrievalJudgment[], k: number) {
	const scored = judgments.map((j) => scoreRetrieval(j, k))
	return {
		k,
		n: judgments.length,
		recallAtK: mean(scored.map((s) => s.recallAtK)),
		precisionAtK: mean(scored.map((s) => s.precisionAtK)),
		mrr: mean(scored.map((s) => s.mrr)),
		ndcgAtK: mean(scored.map((s) => s.ndcgAtK)),
	}
}
