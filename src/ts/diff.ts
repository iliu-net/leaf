/**
 * diff.ts — line-based diff utility
 *
 * Pure algorithm. Zero dependencies. Reusable by any module that needs
 * to compare two versions of text (history diff, trash content preview, etc.).
 */

export interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
}

/**
 * Line-based diff between two strings.
 * Returns an array of DiffLine: unchanged (' '), added ('+'), removed ('-').
 * Simple LCS-based approach — adequate for note-sized text.
 */
export function computeDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      stack.push({ type: ' ', text: aLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: '+', text: bLines[j - 1] });
      j--;
    } else {
      stack.push({ type: '-', text: aLines[i - 1] });
      i--;
    }
  }

  // Reverse stack for chronological order
  while (stack.length > 0) result.push(stack.pop()!);
  return result;
}
