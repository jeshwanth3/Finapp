/**
 * Insights and their evidence (spec §7.2, §9, §15 phase 6).
 *
 * Every insight must be able to show its work: the transactions, messages or statements
 * that produced it. Evidence therefore lives in a queryable child table rather than a
 * serialised array, and an insight is written together with its evidence in one
 * transaction — an insight whose evidence half failed to write is an unfalsifiable claim.
 */

import { withTransaction } from '../db'
import {
  EVIDENCE_KINDS,
  INSIGHT_SEVERITIES,
  decodeEnum,
  fromSqliteBool,
  toSqliteBool,
  type Insight,
  type InsightEvidence,
  type InsightSeverity,
  type IsoInstant,
} from '../types'
import {
  InvalidArgumentError,
  RecordNotFoundError,
  Repository,
  UniqueConstraintError,
  isUniqueConstraintError,
  newId,
  nowInstant,
  readNullableString,
  readNumber,
  readString,
  type Param,
  type SqlRow,
} from './support'

export interface NewInsight {
  readonly id?: string
  readonly ownerId?: string | null
  /** Free-form discriminator, e.g. `price_increase`, `due_date_risk`. */
  readonly kind: string
  readonly severity: InsightSeverity
  readonly title: string
  readonly body: string
  readonly generatedAt?: IsoInstant
  readonly evidence?: readonly InsightEvidence[]
}

/** Thrown when an insight id is reused. */
export class DuplicateInsightError extends UniqueConstraintError {
  override readonly name = 'DuplicateInsightError'
  constructor(
    readonly id: string,
    options?: { cause?: unknown },
  ) {
    super(`insight ${id} already exists`, options)
  }
}

const SELECT_COLUMNS = `
  id, owner_id, kind, generated_at, severity, title, body,
  is_dismissed, dismissed_at, created_at
`

export class InsightsRepository extends Repository {
  insert(input: NewInsight): Insight {
    if (input.kind.trim() === '') throw new InvalidArgumentError('kind', 'must not be blank')
    if (input.title.trim() === '') throw new InvalidArgumentError('title', 'must not be blank')

    const evidence = dedupeEvidence(input.evidence ?? [])
    const insight: Insight = {
      id: input.id ?? newId(),
      ownerId: input.ownerId ?? null,
      kind: input.kind,
      generatedAt: input.generatedAt ?? nowInstant(),
      severity: input.severity,
      title: input.title,
      body: input.body,
      isDismissed: false,
      dismissedAt: null,
      evidence,
      createdAt: nowInstant(),
    }

    const insertInsight = this.stmt(
      `INSERT INTO insights
         (id, owner_id, kind, generated_at, severity, title, body,
          is_dismissed, dismissed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertEvidence = this.stmt(
      `INSERT INTO insight_evidence (insight_id, owner_id, evidence_kind, evidence_id, ordinal)
       VALUES (?, ?, ?, ?, ?)`,
    )

    try {
      withTransaction(this.db, () => {
        insertInsight.run(
          insight.id,
          insight.ownerId,
          insight.kind,
          insight.generatedAt,
          insight.severity,
          insight.title,
          insight.body,
          toSqliteBool(insight.isDismissed),
          insight.dismissedAt,
          insight.createdAt,
        )
        insight.evidence.forEach((item, index) => {
          insertEvidence.run(insight.id, insight.ownerId, item.kind, item.id, index)
        })
      })
    } catch (cause) {
      if (isUniqueConstraintError(cause)) throw new DuplicateInsightError(insight.id, { cause })
      throw cause
    }

    return insight
  }

  findById(id: string): Insight | null {
    const row = this.stmt(`SELECT ${SELECT_COLUMNS} FROM insights WHERE id = ?`).get(id)
    if (row === undefined) return null
    return this.#hydrate(row)
  }

  getById(id: string): Insight {
    const found = this.findById(id)
    if (found === null) throw new RecordNotFoundError('insight', id)
    return found
  }

  /** Undismissed insights, newest first. What the dashboard shows. */
  listLive(options: { kind?: string; limit?: number } = {}): Insight[] {
    const params: Param[] = []
    let sql = `SELECT ${SELECT_COLUMNS} FROM insights WHERE is_dismissed = 0`
    if (options.kind !== undefined) {
      sql += ' AND kind = ?'
      params.push(options.kind)
    }
    sql += ' ORDER BY generated_at DESC, id'
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new InvalidArgumentError('limit', 'must be a positive integer')
      }
      sql += ' LIMIT ?'
      params.push(options.limit)
    }
    return this.stmt(sql)
      .all(...params)
      .map((row) => this.#hydrate(row))
  }

  /**
   * Every insight citing a given record. Drives "why am I seeing this?" in both
   * directions — from an insight to its evidence, and from a transaction to the
   * conclusions drawn from it.
   */
  listCiting(kind: InsightEvidence['kind'], evidenceId: string): Insight[] {
    return this.stmt(
      `SELECT i.id, i.owner_id, i.kind, i.generated_at, i.severity, i.title, i.body,
              i.is_dismissed, i.dismissed_at, i.created_at
         FROM insights i
         JOIN insight_evidence e ON e.insight_id = i.id
        WHERE e.evidence_kind = ? AND e.evidence_id = ?
        ORDER BY i.generated_at DESC, i.id`,
    )
      .all(kind, evidenceId)
      .map((row) => this.#hydrate(row))
  }

  dismiss(id: string, at: IsoInstant = nowInstant()): Insight {
    const changes = this.stmt(
      `UPDATE insights SET is_dismissed = 1, dismissed_at = ?
        WHERE id = ? AND is_dismissed = 0`,
    ).run(at, id)
    if (changes.changes === 0) {
      // Distinguish "no such insight" from "already dismissed": the second is a no-op the
      // caller can ignore, the first is a bug in the caller.
      const existing = this.findById(id)
      if (existing === null) throw new RecordNotFoundError('insight', id)
      return existing
    }
    return this.getById(id)
  }

  evidenceFor(insightId: string): InsightEvidence[] {
    return this.stmt(
      `SELECT evidence_kind, evidence_id FROM insight_evidence
        WHERE insight_id = ? ORDER BY ordinal, evidence_id`,
    )
      .all(insightId)
      .map((row) => ({
        kind: decodeEnum('insight_evidence', 'evidence_kind', EVIDENCE_KINDS, row['evidence_kind']),
        id: readString(row, 'evidence_id'),
      }))
  }

  countLive(): number {
    const row = this.stmt(`SELECT COUNT(*) AS n FROM insights WHERE is_dismissed = 0`).get()
    return row === undefined ? 0 : readNumber(row, 'n')
  }

  #hydrate(row: SqlRow): Insight {
    const id = readString(row, 'id')
    return {
      id,
      ownerId: readNullableString(row, 'owner_id'),
      kind: readString(row, 'kind'),
      generatedAt: readString(row, 'generated_at'),
      severity: decodeEnum('insights', 'severity', INSIGHT_SEVERITIES, row['severity']),
      title: readString(row, 'title'),
      body: readString(row, 'body'),
      isDismissed: fromSqliteBool('insights', 'is_dismissed', row['is_dismissed']),
      dismissedAt: readNullableString(row, 'dismissed_at'),
      evidence: this.evidenceFor(id),
      createdAt: readString(row, 'created_at'),
    }
  }
}

/**
 * The evidence table is keyed on (insight, kind, id), so a caller listing the same
 * transaction twice would hit a primary-key violation. Citing something twice is not an
 * error worth failing an insight over — it is just a duplicate, so it is collapsed.
 */
function dedupeEvidence(evidence: readonly InsightEvidence[]): InsightEvidence[] {
  const seen = new Set<string>()
  const result: InsightEvidence[] = []
  for (const item of evidence) {
    const key = `${item.kind}\u0000${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}
