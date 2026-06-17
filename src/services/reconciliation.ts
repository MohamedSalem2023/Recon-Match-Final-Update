import _ from 'lodash';
import Fuse from 'fuse.js';
import { parse, isValid, differenceInDays, addDays, subDays } from 'date-fns';

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

export function parseDateStr(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    // Excel date serial number
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  
  if (typeof val === 'string') {
    const s = val.trim();
    // Check for DD/MM/YYYY or MM/DD/YYYY
    const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
      const p1 = parseInt(dmyMatch[1], 10);
      const p2 = parseInt(dmyMatch[2], 10);
      const yr = parseInt(dmyMatch[3], 10);
      
      // Default to DD/MM/YYYY which is common if p1 > 12 (definitely a day).
      // If p1 <= 12 and p2 > 12, then it must be MM/DD/YYYY
      let day = p1;
      let month = p2;

      if (p2 > 12 && p1 <= 12) {
        // MM/DD/YYYY detected
        month = p1;
        day = p2;
      }

      const parsed = new Date(yr, month - 1, day);
      if (isValid(parsed)) return parsed;
    }
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

function findSubsetSum(items: any[], getVal: (item: any) => number, target: number, epsilon = 0.01): any[] | null {
  if (items.length === 0) return null;
  
  const totalSum = items.reduce((acc, item) => acc + getVal(item), 0);
  if (totalSum < target - epsilon) return null;
  if (Math.abs(totalSum - target) <= epsilon) {
     return items;
  }

  const sorted = [...items].sort((a, b) => getVal(b) - getVal(a));
  
  const suffixSums = new Array(sorted.length).fill(0);
  let currentSuffix = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    currentSuffix += getVal(sorted[i]);
    suffixSums[i] = currentSuffix;
  }

  let result: any[] | null = null;
  let iterations = 0;
  const MAX_ITERATIONS = 5000000;

  function backtrack(startIndex: number, currentSum: number, currentPath: any[]) {
    if (result || iterations > MAX_ITERATIONS) return;
    iterations++;
    
    const diff = target - currentSum;
    if (Math.abs(diff) <= epsilon) {
       result = [...currentPath];
       return;
    }
    
    if (diff < -epsilon) return;
    if (startIndex >= sorted.length) return;
    if (currentSum + suffixSums[startIndex] < target - epsilon) return;

    for (let i = startIndex; i < sorted.length; i++) {
      if (i > startIndex && Math.abs(getVal(sorted[i]) - getVal(sorted[i - 1])) < epsilon) {
        continue;
      }
      const val = getVal(sorted[i]);
      if (currentSum + val > target + epsilon) continue;

      currentPath.push(sorted[i]);
      backtrack(i + 1, currentSum + val, currentPath);
      currentPath.pop();
    }
  }

  backtrack(0, 0, []);
  return result;
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

    // 2.5 Exact Amount Match (Ignore Date)
    // Run this permanently to catch any exact amounts that were separated by larger date gaps
    // Since Date Match (Rule 2) already ran, it already paired amounts closer in date.
    for (const a of [...currentA]) {
      if (a[matchType] === 0) continue;
      const bMatchIndex = currentB.findIndex(b => {
        if (b[matchType] === 0) return false;
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
          difference: 0
        });
        removeMatched([a._id], [b._id]);
      }
    }

    // 2.6 Cross-Sign Exact Amount Match (Ignore Date)
    // Sometimes Bank Statements map deposits to Credits, while Books map deposits to Debits.
    // If they share exactly the same absolute amount, we match them here.
    for (const a of [...currentA]) {
      const aVal = a[matchType];
      if (aVal === 0) continue;
      
      const oppositeMatchType = matchType === 'debit' ? 'credit' : 'debit';
      
      const bMatchIndex = currentB.findIndex(b => {
        if (b[oppositeMatchType] === 0) return false;
        return Math.abs(aVal - b[oppositeMatchType]) < 0.01;
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
          debitMatchB: oppositeMatchType === 'debit' ? b.debit : 0,
          creditMatchB: oppositeMatchType === 'credit' ? b.credit : 0,
          totalAmountB: b[oppositeMatchType],
          difference: 0
        });
        removeMatched([a._id], [b._id]);
      }
    }
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

    // 3.5 Smart Daily Combine (POS/Fees grouping)
    if (settings.smartDailyCombine) {
      // Step A: Exact Date Total Match (Many-to-Many on the exact same day)
      const dateMapA: Record<string, typeof currentA> = {};
      const dateMapB: Record<string, typeof currentB> = {};
      
      currentA.forEach(a => {
        if (!a.date || a[matchType] === 0) return;
        const d = `${a.date.getFullYear()}-${a.date.getMonth()}-${a.date.getDate()}`;
        if (!dateMapA[d]) dateMapA[d] = [];
        dateMapA[d].push(a);
      });
      currentB.forEach(b => {
        if (!b.date || b[matchType] === 0) return;
        const d = `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`;
        if (!dateMapB[d]) dateMapB[d] = [];
        dateMapB[d].push(b);
      });

      for (const dateStr of Object.keys(dateMapA)) {
        if (!dateMapB[dateStr]) continue;
        const aItems = dateMapA[dateStr];
        const bItems = dateMapB[dateStr];

        const sumA = aItems.reduce((acc, a) => acc + a[matchType], 0);
        const sumB = bItems.reduce((acc, b) => acc + b[matchType], 0);

        if (sumA > 0 && sumB > 0 && Math.abs(sumA - sumB) < 0.01 && (aItems.length > 1 || bItems.length > 1)) {
          matches.push({
            id: `match-${matches.length}`,
            type: 'combined',
            recordsA: aItems.map(a => a._original),
            recordsB: bItems.map(b => b._original),
            debitMatchA: matchType === 'debit' ? sumA : 0,
            creditMatchA: matchType === 'credit' ? sumA : 0,
            totalAmountA: sumA,
            debitMatchB: matchType === 'debit' ? sumB : 0,
            creditMatchB: matchType === 'credit' ? sumB : 0,
            totalAmountB: sumB,
            difference: 0
          });
          removeMatched(aItems.map(a => a._id), bItems.map(b => b._id));
        }
      }

      // Step A.2: Shifted Date Total Match (Many-to-Many within tolerance)
      if (settings.dateToleranceDays > 0) {
        const dateMapARem: Record<string, typeof currentA> = {};
        const dateMapBRem: Record<string, typeof currentB> = {};
        currentA.forEach(a => {
          if (!a.date || a[matchType] === 0) return;
          const d = `${a.date.getFullYear()}-${a.date.getMonth()}-${a.date.getDate()}`;
          if (!dateMapARem[d]) dateMapARem[d] = [];
          dateMapARem[d].push(a);
        });
        currentB.forEach(b => {
          if (!b.date || b[matchType] === 0) return;
          const d = `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`;
          if (!dateMapBRem[d]) dateMapBRem[d] = [];
          dateMapBRem[d].push(b);
        });

        for (const dateStrA of Object.keys(dateMapARem)) {
          const aItems = dateMapARem[dateStrA];
          if (aItems.length === 0) continue;
          const sumA = aItems.reduce((acc, a) => acc + a[matchType], 0);

          for (const dateStrB of Object.keys(dateMapBRem)) {
            const bItems = dateMapBRem[dateStrB];
            if (bItems.length === 0) continue;

            const [yA, mA, dA] = dateStrA.split('-');
            const dateA = new Date(Number(yA), Number(mA), Number(dA));
            const [yB, mB, dB] = dateStrB.split('-');
            const dateB = new Date(Number(yB), Number(mB), Number(dB));
            if (Math.abs(differenceInDays(dateA, dateB)) <= settings.dateToleranceDays) {
              const sumB = bItems.reduce((acc, b) => acc + b[matchType], 0);
              if (sumA > 0 && sumB > 0 && Math.abs(sumA - sumB) < 0.01 && (aItems.length > 1 || bItems.length > 1)) {
                matches.push({
                  id: `match-${matches.length}`,
                  type: 'combined',
                  recordsA: aItems.map(a => a._original),
                  recordsB: bItems.map(b => b._original),
                  debitMatchA: matchType === 'debit' ? sumA : 0,
                  creditMatchA: matchType === 'credit' ? sumA : 0,
                  totalAmountA: sumA,
                  debitMatchB: matchType === 'debit' ? sumB : 0,
                  creditMatchB: matchType === 'credit' ? sumB : 0,
                  totalAmountB: sumB,
                  difference: 0
                });
                removeMatched(aItems.map(a => a._id), bItems.map(b => b._id));
                dateMapARem[dateStrA] = [];
                dateMapBRem[dateStrB] = [];
                break;
              }
            }
          }
        }

        // Step A.3: Sliding Window Block Match (Many-to-Many grouping over tolerance days)
        // Groups M consecutive days in Books with N consecutive days in Bank if their totals match.
        // Good for POS amounts spanning weekends or split across several days.
        let aSorted = [...currentA].filter(x => x.date && x[matchType] > 0).sort((a, b) => a.date!.getTime() - b.date!.getTime());
        if (aSorted.length > 0) {
           let i = 0;
           while(i < aSorted.length) {
              const startA = aSorted[i];
              const windowEnd = addDays(startA.date!, settings.dateToleranceDays);
              
              const blockA = aSorted.filter(a => a.date! >= startA.date! && a.date! <= windowEnd);
              if (blockA.length > 0) {
                 const sumA = blockA.reduce((acc, val) => acc + val[matchType], 0);

                 // Look for B block in the same relative window + tolerance
                 const bStartLimit = subDays(startA.date!, settings.dateToleranceDays);
                 const bEndLimit = addDays(windowEnd, settings.dateToleranceDays);

                 const blockB = currentB.filter(b => b.date && b[matchType] > 0 && b.date >= bStartLimit && b.date <= bEndLimit);
                 if (blockB.length > 0) {
                    const sumB = blockB.reduce((acc, val) => acc + val[matchType], 0);
                    if (Math.abs(sumA - sumB) < 0.01 && (blockA.length > 1 || blockB.length > 1)) {
                         matches.push({
                           id: `match-${matches.length}`,
                           type: 'combined',
                           recordsA: blockA.map(a => a._original),
                           recordsB: blockB.map(b => b._original),
                           debitMatchA: matchType === 'debit' ? sumA : 0,
                           creditMatchA: matchType === 'credit' ? sumA : 0,
                           totalAmountA: sumA,
                           debitMatchB: matchType === 'debit' ? sumB : 0,
                           creditMatchB: matchType === 'credit' ? sumB : 0,
                           totalAmountB: sumB,
                           difference: 0
                         });
                         removeMatched(blockA.map(a => a._id), blockB.map(b => b._id));
                         aSorted = aSorted.filter(a => !blockA.find(x => x._id === a._id));
                         i = 0; // restart
                         continue;
                    }
                 }
              }
              i++;
           }
        }
      }

      // Step B: 1-to-Many: A matches a subset of B
      for (const a of [...currentA]) {
        if (!a.date || a[matchType] === 0) continue;
        
        const poolB = currentB.filter(b => {
          if (!b.date || b[matchType] === 0) return false;
          const diff = Math.abs(differenceInDays(a.date!, b.date));
          return diff <= settings.dateToleranceDays;
        });

        if (poolB.length > 1) {
          const subset = findSubsetSum(poolB, item => item[matchType], a[matchType]);
          if (subset && subset.length > 1) {
            matches.push({
              id: `match-${matches.length}`,
              type: 'combined',
              recordsA: [a._original],
              recordsB: subset.map(b => b._original),
              debitMatchA: matchType === 'debit' ? a.debit : 0,
              creditMatchA: matchType === 'credit' ? a.credit : 0,
              totalAmountA: a[matchType],
              debitMatchB: matchType === 'debit' ? a[matchType] : 0,
              creditMatchB: matchType === 'credit' ? a[matchType] : 0,
              totalAmountB: a[matchType],
              difference: 0
            });
            removeMatched([a._id], subset.map(b => b._id));
            continue;
          }
        }
      }

      // 1-to-Many: B matches a subset of A
      for (const b of [...currentB]) {
        if (!b.date || b[matchType] === 0) continue;
        
        const poolA = currentA.filter(a => {
          if (!a.date || a[matchType] === 0) return false;
          const diff = Math.abs(differenceInDays(b.date!, a.date));
          return diff <= settings.dateToleranceDays;
        });

        if (poolA.length > 1) {
          const subset = findSubsetSum(poolA, item => item[matchType], b[matchType]);
          if (subset && subset.length > 1) {
            matches.push({
              id: `match-${matches.length}`,
              type: 'combined',
              recordsA: subset.map(a => a._original),
              recordsB: [b._original],
              debitMatchA: matchType === 'debit' ? b[matchType] : 0,
              creditMatchA: matchType === 'credit' ? b[matchType] : 0,
              totalAmountA: b[matchType],
              debitMatchB: matchType === 'debit' ? b.debit : 0,
              creditMatchB: matchType === 'credit' ? b.credit : 0,
              totalAmountB: b[matchType],
              difference: 0
            });
            removeMatched(subset.map(a => a._id), [b._id]);
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
