import { Request, Response } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Review } from '../models';
import { logError, logInfo } from '../utils/loggerHelper';

/** Used when CSV has no `type` column or a row has an empty type cell. */
const DEFAULT_REVIEW_TYPE = 'Solar Customer';

const KNOWN_CSV_HEADERS = new Set(['content', 'type', 'id', 'isused', 'usedby']);

/** True if the row looks like a header (every cell is a known column name). */
function isHeaderRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => {
    const n = c.replace(/^\ufeff/, '').trim().toLowerCase();
    return KNOWN_CSV_HEADERS.has(n);
  });
}

/** Split one CSV line into fields; supports quoted fields with commas. */
function parseCsvRow(line: string): string[] {
  const row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  return row;
}

function parseBool(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  const v = value.toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function buildColumnIndex(firstRowCells: string[]): { map: Record<string, number>; hasHeader: boolean } {
  if (isHeaderRow(firstRowCells)) {
    const lower = firstRowCells.map((c) => c.replace(/^\ufeff/, '').trim().toLowerCase());
    const map: Record<string, number> = {};
    lower.forEach((name, i) => {
      const key = name === 'isused' ? 'isUsed' : name === 'usedby' ? 'usedBy' : name;
      map[key] = i;
    });
    return { map, hasHeader: true };
  }
  // Data rows without header: one column = content only; two+ = content, type, …
  if (firstRowCells.length === 1) {
    return {
      map: { content: 0, type: -1, id: -1, isused: -1, usedby: -1 },
      hasHeader: false
    };
  }
  return {
    map: { content: 0, type: 1, id: -1, isused: -1, usedby: -1 },
    hasHeader: false
  };
}

function cell(row: string[], map: Record<string, number>, key: string): string | undefined {
  const idx = map[key];
  if (idx === undefined || idx < 0) return undefined;
  return row[idx];
}

/** Truncate for human-readable messages (full `content` still on the error object when set). */
function previewContent(content: string, maxLen = 160): string {
  if (content.length <= maxLen) return content;
  return `${content.slice(0, maxLen)}…`;
}

type CsvImportRowError = {
  line: number;
  message: string;
  code?: string;
  /** Present for duplicate / validation issues tied to a row’s text */
  content?: string;
  /** Existing DB row when duplicate is against the database */
  existingReviewId?: string;
};

// GET /api/reviews — paginated list, optional filters
export const getReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type as string | undefined;
    const isUsedRaw = req.query.isUsed as string | undefined;

    const where: Record<string, unknown> = {};
    if (type) {
      where.type = type;
    }
    if (isUsedRaw === 'true' || isUsedRaw === 'false') {
      where.isUsed = isUsedRaw === 'true';
    } else {
      where.isUsed = false;
    }

    const { rows, count } = await Review.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'content']
    });

    const reviewsPlain = rows.map((r) => r.get({ plain: true }));
    logInfo('Get reviews', {
      page,
      limit,
      total: count,
      filters: { type, isUsed: isUsedRaw },
      reviews: reviewsPlain
    });

    res.json({
      reviews: reviewsPlain,
      totalCount: count,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    logError('Get reviews error', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/reviews/:id/mark-used
export const markReviewAsUsed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const usedByFromBody = typeof req.body?.usedBy === 'string' ? req.body.usedBy.trim() : '';
    const usedBy =
      usedByFromBody ||
      (req.user && 'id' in req.user ? req.user.id : '') ||
      null;

    const review = await Review.findByPk(id, { attributes: ['id', 'content', 'isUsed'] });
    if (!review) {
      res.status(404).json({ error: 'Review not found' });
      return;
    }

    if (review.isUsed) {
      res.status(409).json({
        error: 'Review is already marked as used',
        review: review.get({ plain: true })
      });
      return;
    }

    await review.update({
      isUsed: true,
      usedBy: usedBy || null
    });

    const updated = review.get({ plain: true });
    logInfo('Review marked as used', { reviewId: id, usedBy: updated.usedBy });

    res.json({
      message: 'Review marked as used',
      review: updated
    });
  } catch (error) {
    logError('Mark review as used error', error, { reviewId: req.params.id });
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/reviews/import — multipart file field "file"
export const importReviewsFromCsv = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file?.path) {
    res.status(400).json({ error: 'CSV file is required (field name: file)' });
    return;
  }

  try {
    let raw = fs.readFileSync(file.path, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

    if (lines.length === 0) {
      res.status(400).json({ error: 'CSV is empty' });
      return;
    }

    const firstRow = parseCsvRow(lines[0]);
    const { map, hasHeader } = buildColumnIndex(firstRow);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const imported: string[] = [];
    const failed: CsvImportRowError[] = [];
    const contentSeenInFile = new Set<string>();

    let lineNo = hasHeader ? 2 : 1;
    for (const line of dataLines) {
      const cells = parseCsvRow(line);
      const rawContent = cell(cells, map, 'content')?.replace(/^"|"$/g, '') ?? '';
      const rawType = cell(cells, map, 'type')?.replace(/^"|"$/g, '') ?? '';
      const idCell = cell(cells, map, 'id')?.replace(/^"|"$/g, '');
      const isUsedCell = cell(cells, map, 'isUsed');
      const usedByCell = cell(cells, map, 'usedBy')?.replace(/^"|"$/g, '');

      const content = rawContent.trim();
      const typeVal = rawType.trim() || DEFAULT_REVIEW_TYPE;

      if (!content) {
        failed.push({
          line: lineNo,
          code: 'MISSING_CONTENT',
          message: 'content is required (row is empty or missing the content column)'
        });
        lineNo++;
        continue;
      }

      if (contentSeenInFile.has(content)) {
        failed.push({
          line: lineNo,
          code: 'DUPLICATE_IN_FILE',
          content,
          message: `Duplicate in this CSV: the same text appears again on line ${lineNo}. First occurrence was kept; this row was skipped. Text: "${previewContent(content)}"`
        });
        lineNo++;
        continue;
      }

      const existing = await Review.findOne({
        where: { content },
        attributes: ['id']
      });
      if (existing) {
        failed.push({
          line: lineNo,
          code: 'DUPLICATE_IN_DATABASE',
          content,
          existingReviewId: existing.id,
          message: `Duplicate: this text is already stored as review id "${existing.id}" (line ${lineNo}). Text: "${previewContent(content)}"`
        });
        lineNo++;
        continue;
      }

      const id = idCell && idCell.length > 0 ? idCell : uuidv4();
      const isUsed = parseBool(isUsedCell);
      const usedBy = usedByCell && usedByCell.length > 0 ? usedByCell : null;

      contentSeenInFile.add(content);
      try {
        await Review.create({
          id,
          content,
          type: typeVal,
          isUsed,
          usedBy
        });
        imported.push(id);
      } catch (err: unknown) {
        contentSeenInFile.delete(content);
        const msg = err instanceof Error ? err.message : 'Insert failed';
        failed.push({
          line: lineNo,
          code: 'INSERT_FAILED',
          content,
          message: `Could not insert line ${lineNo}: ${msg}. Content: "${previewContent(content)}"`
        });
      }
      lineNo++;
    }

    logInfo('Reviews CSV import', { imported: imported.length, failed: failed.length });

    res.status(201).json({
      message: 'Import finished',
      imported: imported.length,
      failed: failed.length,
      ids: imported,
      errors: failed
    });
  } catch (error) {
    logError('Import reviews CSV error', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
  }
};
