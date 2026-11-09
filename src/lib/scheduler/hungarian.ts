/**
 * Hungarian algorithm (Kuhn–Munkres, O(n^3)) for rectangular min-cost assignment.
 * cost[i][j] with rows <= cols is not required; the matrix is padded internally.
 * Returns, for each row, the assigned column index (or -1 when matched to padding).
 */
export function hungarian(cost: number[][]): number[] {
  const nRows = cost.length;
  if (nRows === 0) return [];
  const nCols = cost[0].length;
  const n = Math.max(nRows, nCols);
  const a: number[][] = [];
  for (let i = 0; i < n; i++) {
    a.push([]);
    for (let j = 0; j < n; j++) a[i].push(i < nRows && j < nCols ? cost[i][j] : 0);
  }
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const result = new Array(nRows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const row = p[j] - 1;
    if (row >= 0 && row < nRows && j - 1 < nCols) result[row] = j - 1;
  }
  return result;
}

