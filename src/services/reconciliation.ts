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

function parseDateStr(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    // Excel date serial number
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  const d = new Date(val);
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
      date: parseDateStr(r[mappingsA.date || '']),
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
      date: parseDateStr(r[mappingsB.date || '']),
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

  // ---- Daily Aggregation Step (POS / Bank Commissions) ----
  // One side (aggregatedSide) records POS/commission as a single daily total,
  // the other side (detailSide) lists each transaction individually. We sum
  // detail-side records sharing the same date AND a matching keyword, and try
  // to match the daily sum against the single aggregated entry.
  const runDailyAggregationMatch = () => {
    if (!settings.enableDailyAggregation) return;

    const rawKeywords = (settings.aggregationKeywords || '')
      .split(/[,\n;]/)
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    if (rawKeywords.length === 0) return;

    const aggregatedSide = settings.aggregationSide || 'A';
    const aggregatedPool = aggregatedSide === 'A' ? currentA : currentB;
    const detailPool = aggregatedSide === 'A' ? currentB : currentA;

    const matchesKeyword = (item: any) => {
      const hay = `${item.desc || ''} ${item.ref || ''}`.toLowerCase();
      return rawKeywords.some(k => hay.includes(k));
    };

    const sameDay = (d1: Date | null, d2: Date | null) => {
      if (!d1 || !d2) return false;
      return Math.abs(differenceInDays(d1, d2)) <= settings.dateToleranceDays;
    };

    for (const side of ['debit', 'credit'] as const) {
      const aggCandidates = aggregatedPool.filter(item => matchesKeyword(item) && item[side] > 0 && item.date);

      for (const agg of aggCandidates) {
        // re-check it's still in the pool (may have been removed by previous side)
        const stillThere = aggregatedSide === 'A'
          ? currentA.some(x => x._id === agg._id)
          : currentB.some(x => x._id === agg._id);
        if (!stillThere) continue;

        const detailCurrent = aggregatedSide === 'A' ? currentB : currentA;
        const dailyGroup = detailCurrent.filter(d =>
          matchesKeyword(d) && d[side] > 0 && sameDay(d.date, agg.date)
        );

        if (dailyGroup.length === 0) continue;

        const sumDaily = _.sumBy(dailyGroup, side);

        if (Math.abs(agg[side] - sumDaily) < 0.01) {
          // Exact daily aggregate match
          const recordsA = aggregatedSide === 'A' ? [agg._original] : dailyGroup.map(d => d._original);
          const recordsB = aggregatedSide === 'A' ? dailyGroup.map(d => d._original) : [agg._original];
          const aSideAmount = aggregatedSide === 'A' ? agg[side] : sumDaily;
          const bSideAmount = aggregatedSide === 'A' ? sumDaily : agg[side];

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

          if (aggregatedSide === 'A') {
            removeMatched([agg._id], dailyGroup.map(d => d._id));
          } else {
            removeMatched(dailyGroup.map(d => d._id), [agg._id]);
          }
        } else {
          // Sum exists but does not equal aggregated amount → report as adjustment
          const recordA = aggregatedSide === 'A' ? agg._original : { __aggregated: true, items: dailyGroup.map(d => d._original) };
          const recordB = aggregatedSide === 'A' ? { __aggregated: true, items: dailyGroup.map(d => d._original) } : agg._original;
          const amountA = aggregatedSide === 'A' ? agg[side] : sumDaily;
          const amountB = aggregatedSide === 'A' ? sumDaily : agg[side];

          adjustments.push({
            id: `adj-${adjustments.length}`,
            identifier: `Daily ${side === 'debit' ? 'Debit' : 'Credit'} Aggregate (${agg.date ? agg.date.toISOString().slice(0,10) : ''})`,
            recordA,
            recordB,
            debitA: side === 'debit' ? amountA : 0,
            creditA: side === 'credit' ? amountA : 0,
            amountA,
            debitB: side === 'debit' ? amountB : 0,
            creditB: side === 'credit' ? amountB : 0,
            amountB,
            difference: amountB - amountA,
            approved: true
          });

          if (aggregatedSide === 'A') {
            removeMatched([agg._id], dailyGroup.map(d => d._id));
          } else {
            removeMatched(dailyGroup.map(d => d._id), [agg._id]);
          }
        }
      }
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
