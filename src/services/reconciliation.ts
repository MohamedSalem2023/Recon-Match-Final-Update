import _ from 'lodash';
import Fuse from 'fuse.js';
import { parse, isValid, differenceInDays } from 'date-fns';

import { FieldMapping, ReconcileSettings, MatchResult, Adjustment, ReconciliationResponse } from '../types.js';

export function getDynamicLabel(record: any, mappings: FieldMapping): string {
  if (!record || !mappings) return 'No Identifier';

  const parts: string[] = [];

  if (mappings.residencyId && record[mappings.residencyId]) {
    parts.push(`Residency ID: ${record[mappings.residencyId]}`);
  }
  if (mappings.patientFileNumber && record[mappings.patientFileNumber]) {
    parts.push(`Patient File: ${record[mappings.patientFileNumber]}`);
  }
  if (mappings.reference && record[mappings.reference]) {
    parts.push(`Ref: ${record[mappings.reference]}`);
  }
  if (mappings.description && record[mappings.description]) {
    parts.push(String(record[mappings.description]));
  }

  if (parts.length === 0) {
    return 'No Identifier';
  }

  return parts.join(' | ');
}

export function parseAmount(val: any): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val.replace(/[^0-9.-]+/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function parseDateStr(val: any, hint: 'auto' | 'dmy' | 'mdy' | 'ymd' = 'auto'): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return isValid(val) ? val : null;
  if (typeof val === 'number') {
    // Excel date serial number
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isValid(d) ? d : null;
  }

  const raw = String(val).trim();
  if (!raw) return null;

  // ISO-like 2026-05-01 or 2026/05/01
  const iso = raw.match(/^(\d{4})[\-\/\.](\d{1,2})[\-\/\.](\d{1,2})/);
  if (iso) {
    const [, y, m, dd] = iso;
    const d = new Date(Number(y), Number(m) - 1, Number(dd));
    return isValid(d) ? d : null;
  }

  // dd[\/\-\.]mm[\/\-\.]yyyy  OR  mm[\/\-\.]dd[\/\-\.]yyyy
  const parts = raw.match(/^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2,4})/);
  if (parts) {
    let [, p1, p2, p3] = parts;
    let year = Number(p3);
    if (year < 100) year += 2000;

    const tryBuild = (day: number, month: number) => {
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const d = new Date(year, month - 1, day);
      return isValid(d) ? d : null;
    };

    if (hint === 'dmy') return tryBuild(Number(p1), Number(p2));
    if (hint === 'mdy') return tryBuild(Number(p2), Number(p1));
    if (hint === 'ymd') {
      // shouldn't hit here, fallback
      return tryBuild(Number(p3), Number(p2));
    }

    // auto: if one side is clearly > 12, use it to disambiguate
    const n1 = Number(p1), n2 = Number(p2);
    if (n1 > 12 && n2 <= 12) return tryBuild(n1, n2); // dd/mm
    if (n2 > 12 && n1 <= 12) return tryBuild(n2, n1); // mm/dd → flipped means n1 is month
    // default: assume DD/MM/YYYY (most common globally outside US)
    return tryBuild(n1, n2);
  }

  // Last resort: native Date (handles ISO timestamps, RFC, etc.)
  const d = new Date(raw);
  return isValid(d) ? d : null;
}

export function getDebitCredit(r: any, mappings: FieldMapping): { debit: number, credit: number } {
  let debit = 0;
  let credit = 0;
  if (mappings.amount) {
    const amount = parseAmount(r[mappings.amount]);
    if (amount > 0) debit = amount;
    else if (amount < 0) credit = Math.abs(amount);
  } else {
    if (mappings.debit) debit = Math.abs(parseAmount(r[mappings.debit]));
    if (mappings.credit) credit = Math.abs(parseAmount(r[mappings.credit]));
  }
  return { debit, credit };
}

export function reconcileData(
  datasetA: any[],
  datasetB: any[],
  mappingsA: FieldMapping,
  mappingsB: FieldMapping,
  settings: ReconcileSettings
): ReconciliationResponse {
  const matches: MatchResult[] = [];
  const adjustments: Adjustment[] = [];
  let remainingA = [...datasetA];
  let remainingB = [...datasetB];

  // Normalize data
  const normA = remainingA.map((r, i) => {
    const { debit, credit } = getDebitCredit(r, mappingsA);
    return {
      _original: r,
      _id: `A-${i}`,
      debit,
      credit,
      amount: debit - credit, // Net amount for summary
      date: parseDateStr(r[mappingsA.date || ''], settings.dateFormatA || 'auto'),
      ref: String(r[mappingsA.reference || ''] || '').trim().toLowerCase(),
      desc: String(r[mappingsA.description || ''] || '').trim().toLowerCase(),
      resId: String(r[mappingsA.residencyId || ''] || '').trim(),
      patId: String(r[mappingsA.patientFileNumber || ''] || '').trim(),
    };
  });

  const normB = remainingB.map((r, i) => {
    const { debit, credit } = getDebitCredit(r, mappingsB);
    return {
      _original: r,
      _id: `B-${i}`,
      debit,
      credit,
      amount: debit - credit,
      date: parseDateStr(r[mappingsB.date || ''], settings.dateFormatB || 'auto'),
      ref: String(r[mappingsB.reference || ''] || '').trim().toLowerCase(),
      desc: String(r[mappingsB.description || ''] || '').trim().toLowerCase(),
      resId: String(r[mappingsB.residencyId || ''] || '').trim(),
      patId: String(r[mappingsB.patientFileNumber || ''] || '').trim(),
    };
  });

  let currentA = [...normA];
  let currentB = [...normB];

  const removeMatched = (matchedAIds: string[], matchedBIds: string[]) => {
    currentA = currentA.filter(a => !matchedAIds.includes(a._id));
    currentB = currentB.filter(b => !matchedBIds.includes(b._id));
  };

  // ---- Daily Aggregation Step (POS / Bank Commissions / Daily Subset-Sum) ----
  //
  // BILATERAL daily matching. For each date appearing in either dataset, we
  // automatically detect which side is "aggregated" (fewer entries that day)
  // and which side is "detailed" (more entries that day), then for every
  // aggregated entry we look for a subset of detail-side entries summing to
  // it. Works without any keywords by default, runs in BOTH directions, and
  // does not require the user to pre-select which dataset is which.
  //
  // Always runs unless explicitly disabled with `enableDailyAggregation:false`.
  const runDailyAggregationMatch = () => {
    if (settings.enableDailyAggregation === false) return;

    const tol = (typeof settings.amountTolerance === 'number' && settings.amountTolerance >= 0)
      ? settings.amountTolerance
      : 0.01;

    const rawKeywords = (settings.aggregationKeywords || '')
      .split(/[,\n;]/)
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);
    const useKeywordFilter = !!settings.subsetSumKeywordFilter && rawKeywords.length > 0;

    const matchesKeyword = (item: any) => {
      if (!useKeywordFilter) return true;
      const hay = `${item.desc || ''} ${item.ref || ''}`.toLowerCase();
      return rawKeywords.some(k => hay.includes(k));
    };

    const dayKey = (d: Date | null) => d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : '';

    // Branch-and-bound subset-sum. Returns indices of items summing to target.
    const findSubset = (items: { idx: number; amt: number }[], target: number): number[] | null => {
      if (items.length === 0) return null;
      const sorted = [...items].sort((a, b) => b.amt - a.amt);
      const suffix: number[] = new Array(sorted.length + 1).fill(0);
      for (let i = sorted.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sorted[i].amt;

      let result: number[] | null = null;
      const stack: number[] = [];
      let steps = 0;
      const MAX_STEPS = 2_000_000; // safety guard for very large daily groups

      const dfs = (pos: number, remaining: number): boolean => {
        if (++steps > MAX_STEPS) return false;
        if (Math.abs(remaining) <= tol) {
          result = stack.map(i => sorted[i].idx);
          return true;
        }
        if (pos >= sorted.length) return false;
        if (remaining < -tol) return false;
        if (suffix[pos] + tol < remaining) return false;
        if (sorted[pos].amt <= remaining + tol) {
          stack.push(pos);
          if (dfs(pos + 1, remaining - sorted[pos].amt)) return true;
          stack.pop();
        }
        return dfs(pos + 1, remaining);
      };
      dfs(0, target);
      return result;
    };

    // For one direction (aggregated side → detail side), try to match each
    // aggregated entry against a subset of detail-side rows on the same day.
    const matchDirection = (aggregatedSide: 'A' | 'B', side: 'debit' | 'credit') => {
      const aggLive = () => aggregatedSide === 'A' ? currentA : currentB;
      const detailLive = () => aggregatedSide === 'A' ? currentB : currentA;

      const aggPool = aggLive().filter(x => x[side] > 0 && x.date && matchesKeyword(x));
      const aggByDay = _.groupBy(aggPool, x => dayKey(x.date));

      for (const day of Object.keys(aggByDay)) {
        // smallest first so that a 1:1 entry is consumed by a small aggregated
        // entry before a bigger entry sweeps the row into a subset
        const aggEntries = aggByDay[day].sort((a, b) => a[side] - b[side]);

        let detailPool = detailLive().filter(d =>
          d[side] > 0 && d.date && matchesKeyword(d) &&
          dayKey(d.date) === day
        );
        // also allow date tolerance windows
        if (settings.dateToleranceDays > 0 && aggEntries[0]?.date) {
          const refDate = aggEntries[0].date!;
          detailPool = detailLive().filter(d =>
            d[side] > 0 && d.date && matchesKeyword(d) &&
            Math.abs(differenceInDays(d.date!, refDate)) <= settings.dateToleranceDays
          );
        }

        for (const agg of aggEntries) {
          const stillThere = aggregatedSide === 'A'
            ? currentA.some(x => x._id === agg._id)
            : currentB.some(x => x._id === agg._id);
          if (!stillThere) continue;
          if (detailPool.length === 0) continue;

          let chosenIds: string[] | null = null;

          // 1) Prefer single-row exact match (1:1 over n:1)
          const singleIdx = detailPool.findIndex(d => Math.abs(d[side] - agg[side]) <= tol);
          if (singleIdx !== -1) {
            chosenIds = [detailPool[singleIdx]._id];
          } else if (settings.enableSubsetSum !== false) {
            // 2) Subset-sum
            const items = detailPool.map((d, i) => ({ idx: i, amt: d[side] }));
            const subsetIdx = findSubset(items, agg[side]);
            if (subsetIdx && subsetIdx.length > 0) {
              chosenIds = subsetIdx.map(i => detailPool[i]._id);
            }
          }

          if (chosenIds && chosenIds.length > 0) {
            const chosenSet = new Set(chosenIds);
            const chosenItems = detailPool.filter(d => chosenSet.has(d._id));
            const sumChosen = _.sumBy(chosenItems, side);

            const recordsA = aggregatedSide === 'A' ? [agg._original] : chosenItems.map(d => d._original);
            const recordsB = aggregatedSide === 'A' ? chosenItems.map(d => d._original) : [agg._original];
            const aSideAmount = aggregatedSide === 'A' ? agg[side] : sumChosen;
            const bSideAmount = aggregatedSide === 'A' ? sumChosen : agg[side];

            matches.push({
              id: `match-${matches.length}`,
              type: 'daily-aggregate',
              recordsA,
              recordsB,
              debitMatchA: side === 'debit' ? aSideAmount : 0,
              creditMatchA: side === 'credit' ? aSideAmount : 0,
              totalAmountA: aSideAmount,
              debitMatchB: side === 'debit' ? bSideAmount : 0,
              creditMatchB: side === 'credit' ? bSideAmount : 0,
              totalAmountB: bSideAmount,
              difference: Math.abs(aSideAmount) - Math.abs(bSideAmount)
            });

            if (aggregatedSide === 'A') removeMatched([agg._id], chosenIds);
            else removeMatched(chosenIds, [agg._id]);

            detailPool = detailPool.filter(d => !chosenSet.has(d._id));
          }
        }
      }
    };

    // Auto-detect which side is "aggregated" per day, but actually we run BOTH
    // directions to cover all cases (some days A may aggregate, on other days
    // it could be B that aggregates).
    for (const side of ['debit', 'credit'] as const) {
      // First pass: side A is aggregated
      matchDirection('A', side);
      // Second pass: side B is aggregated (handles the reverse case)
      matchDirection('B', side);
    }
  };

  runDailyAggregationMatch();

  const runMatchingEngine = (matchType: 'debit' | 'credit') => {
    // 1. Exact Match (Identifier + Amount)
    for (const a of [...currentA]) {
      if (a[matchType] === 0) continue;
      const bMatchIndex = currentB.findIndex(b => {
        if (b[matchType] === 0) return false;
        const matchRef = a.ref && b.ref && a.ref === b.ref;
        const matchResId = a.resId && b.resId && a.resId === b.resId;
        const matchPatId = a.patId && b.patId && a.patId === b.patId;
        const hasId = matchRef || matchResId || matchPatId;
        if (!hasId) return false;

        return Math.abs(a[matchType] - b[matchType]) < 0.01;
      });

      if (bMatchIndex !== -1) {
        const b = currentB[bMatchIndex];
        matches.push({
          id: `match-${matches.length}`,
          type: 'exact',
          recordsA: [a._original],
          recordsB: [b._original],
          debitMatchA: matchType === 'debit' ? a.debit : 0,
          creditMatchA: matchType === 'credit' ? a.credit : 0,
          totalAmountA: a[matchType],
          debitMatchB: matchType === 'debit' ? b.debit : 0,
          creditMatchB: matchType === 'credit' ? b.credit : 0,
          totalAmountB: b[matchType],
          difference: Math.abs(a[matchType]) - Math.abs(b[matchType])
        });
        removeMatched([a._id], [b._id]);
      }
    }

    // 1.5 Identifier Match (Different Amount) -> Adjustments
    for (const a of [...currentA]) {
      if (a[matchType] === 0) continue;
      const bMatchIndex = currentB.findIndex(b => {
        if (b[matchType] === 0) return false;
        const matchRef = a.ref && b.ref && a.ref === b.ref;
        const matchResId = a.resId && b.resId && a.resId === b.resId;
        const matchPatId = a.patId && b.patId && a.patId === b.patId;
        return matchRef || matchResId || matchPatId;
      });

      if (bMatchIndex !== -1) {
        const b = currentB[bMatchIndex];
        adjustments.push({
          id: `adj-${adjustments.length}`,
          identifier: getDynamicLabel(a._original, mappingsA),
          recordA: a._original,
          recordB: b._original,
          debitA: matchType === 'debit' ? a.debit : 0,
          creditA: matchType === 'credit' ? a.credit : 0,
          amountA: a[matchType],
          debitB: matchType === 'debit' ? b.debit : 0,
          creditB: matchType === 'credit' ? b.credit : 0,
          amountB: b[matchType],
          difference: b[matchType] - a[matchType],
          approved: true
        });
        removeMatched([a._id], [b._id]);
      }
    }

    // 2. Exact Amount & Date Match (within tolerance)
    for (const a of [...currentA]) {
      if (a[matchType] === 0) continue;
      const bMatchIndex = currentB.findIndex(b => {
        if (b[matchType] === 0) return false;
        if (Math.abs(a[matchType] - b[matchType]) >= 0.01) return false;

        if (a.date && b.date) {
          const diff = Math.abs(differenceInDays(a.date, b.date));
          return diff <= settings.dateToleranceDays;
        }
        return false;
      });

      if (bMatchIndex !== -1) {
        const b = currentB[bMatchIndex];
        matches.push({
          id: `match-${matches.length}`,
          type: 'exact',
          recordsA: [a._original],
          recordsB: [b._original],
          debitMatchA: matchType === 'debit' ? a.debit : 0,
          creditMatchA: matchType === 'credit' ? a.credit : 0,
          totalAmountA: a[matchType],
          debitMatchB: matchType === 'debit' ? b.debit : 0,
          creditMatchB: matchType === 'credit' ? b.credit : 0,
          totalAmountB: b[matchType],
          difference: Math.abs(a[matchType]) - Math.abs(b[matchType])
        });
        removeMatched([a._id], [b._id]);
      }
    }

    // 3. One-to-Many Match (Combined Amount)
    if (settings.matchOneToMany) {
      const bByRef = _.groupBy(currentB.filter(b => b.ref && b[matchType] > 0), 'ref');
      
      for (const a of [...currentA]) {
        if (!a.ref || a[matchType] === 0) continue;
        const bGroup = bByRef[a.ref];
        if (bGroup && bGroup.length > 0) {
          const sumB = _.sumBy(bGroup, matchType);
          
          if (Math.abs(a[matchType] - sumB) < 0.01) {
            matches.push({
              id: `match-${matches.length}`,
              type: 'combined',
              recordsA: [a._original],
              recordsB: bGroup.map(b => b._original),
              debitMatchA: matchType === 'debit' ? a.debit : 0,
              creditMatchA: matchType === 'credit' ? a.credit : 0,
              totalAmountA: a[matchType],
              debitMatchB: matchType === 'debit' ? sumB : 0,
              creditMatchB: matchType === 'credit' ? sumB : 0,
              totalAmountB: sumB,
              difference: Math.abs(a[matchType]) - Math.abs(sumB)
            });
            removeMatched([a._id], bGroup.map(b => b._id));
            delete bByRef[a.ref];
          }
        }
      }
    }

    // 4. Fuzzy Match (Description / Reference)
    if (currentA.length > 0 && currentB.length > 0) {
      for (const a of [...currentA]) {
        if (a[matchType] === 0) continue;
        const searchStr = `${a.desc} ${a.ref} ${a.resId} ${a.patId}`.trim();
        if (!searchStr) continue;

        const fuse = new Fuse(currentB.filter(b => b[matchType] > 0), {
          keys: ['desc', 'ref', 'resId', 'patId'],
          threshold: settings.fuzzyThreshold,
          includeScore: true
        });

        const results = fuse.search(searchStr);
        const bestMatch = results.find(r => {
          const b = r.item;
          return Math.abs(a[matchType] - b[matchType]) < 0.01;
        });

        if (bestMatch) {
          const b = bestMatch.item;
          matches.push({
            id: `match-${matches.length}`,
            type: 'fuzzy',
            recordsA: [a._original],
            recordsB: [b._original],
            debitMatchA: matchType === 'debit' ? a.debit : 0,
            creditMatchA: matchType === 'credit' ? a.credit : 0,
            totalAmountA: a[matchType],
            debitMatchB: matchType === 'debit' ? b.debit : 0,
            creditMatchB: matchType === 'credit' ? b.credit : 0,
            totalAmountB: b[matchType],
            difference: Math.abs(a[matchType]) - Math.abs(b[matchType])
          });
          removeMatched([a._id], [b._id]);
        }
      }
    }
  };

  runMatchingEngine('debit');
  runMatchingEngine('credit');

  const unmatchedA = currentA.map(a => a._original);
  const unmatchedB = currentB.map(b => b._original);

  const matchedACount = datasetA.length - unmatchedA.length;
  const matchedBCount = datasetB.length - unmatchedB.length;

  // Calculate Bank Reconciliation
  const openingBalance = _.sumBy(normA, a => a.debit + a.credit);
  const targetBalance = _.sumBy(normB, b => b.debit + b.credit);
  
  // Additions = Unmatched B (Net amount)
  const totalAdditions = _.sumBy(currentB, b => b.debit + b.credit);
  
  // Deductions = Unmatched A (Net amount)
  const totalDeductions = _.sumBy(currentA, a => a.debit + a.credit);
  
  // Net Adjustments
  const netAdjustments = _.sumBy(adjustments.filter(a => a.approved), a => a.amountB - a.amountA);
  
  const adjustedBalance = openingBalance + totalAdditions - totalDeductions + netAdjustments;
  const difference = adjustedBalance - targetBalance;
  const isBalanced = Math.abs(difference) < 0.01;

  return {
    matches,
    adjustments,
    unmatchedA,
    unmatchedB,
    summary: {
      totalA: datasetA.length,
      totalB: datasetB.length,
      matchedA: matchedACount,
      matchedB: matchedBCount,
      matchPercentageA: datasetA.length ? Math.round((matchedACount / datasetA.length) * 100) : 0,
      matchPercentageB: datasetB.length ? Math.round((matchedBCount / datasetB.length) * 100) : 0,
    },
    bankReconciliation: {
      openingBalance,
      totalAdditions,
      totalDeductions,
      netAdjustments,
      adjustedBalance,
      targetBalance,
      difference,
      isBalanced
    },
    mappingsA,
    mappingsB
  };
}
